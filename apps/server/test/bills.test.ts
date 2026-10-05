import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;
let teh: { id: string };
let stick: { id: string };

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id);
  const cat = await prisma.category.create({ data: { name: 'Minuman' } });
  teh = await prisma.product.create({ data: { name: 'Es Teh', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 10 } });
  stick = await prisma.product.create({ data: { name: 'Sewa Stick', categoryId: cat.id, kind: 'SERVICE', price: 10000 } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });

async function playAndStop(unitId = b.m1.id, minutes = 60) {
  const s = (await req('POST', '/api/sessions', { unitId, mode: 'OPEN' })).json().unit.session;
  t.clock.advanceMinutes(minutes);
  await req('POST', `/api/sessions/${s.id}/stop`, {});
  t.clock.set(new Date('2026-10-01T03:00:00Z'));
  return s.billId as string;
}

describe('stop membuat baris waktu', () => {
  it('bill tetap OPEN dengan satu baris TIME berisi rincian tarif; meja kosong', async () => {
    const billId = await playAndStop();
    const bill = (await req('GET', `/api/bills/${billId}`)).json();
    expect(bill).toMatchObject({ status: 'OPEN', label: 'Meja 1', activeSessions: [], stored: null });
    expect(bill.lines).toEqual([
      expect.objectContaining({ type: 'TIME', name: 'Meja 1 - Open billing', unitPrice: 40000, qty: 1, discount: null }),
    ]);
    expect(bill.lines[0].breakdown[0]).toMatchObject({ label: 'Reguler Siang', minutes: 60, amount: 40000 });
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: b.m1.id }, include: { activeSession: true } });
    expect(unit.activeSession).toBeNull();
  });

  it('bill sesi berjalan menampilkan activeSessions', async () => {
    const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    const bill = (await req('GET', `/api/bills/${s.billId}`)).json();
    expect(bill.activeSessions).toHaveLength(1);
    expect(bill.activeSessions[0]).toMatchObject({ id: s.id, unitName: 'Meja 1', status: 'RUNNING' });
  });
});

describe('tagihan lepas & item', () => {
  it('tagihan lepas butuh shift', async () => {
    await prisma.shift.updateMany({ data: { openFlag: null, closedAt: new Date() } });
    const res = await req('POST', '/api/bills');
    expect(res.json().error.code).toBe('NO_OPEN_SHIFT');
  });

  it('tambah produk, produk sama digabung qty, item manual diaudit', async () => {
    const bill = (await req('POST', '/api/bills')).json();
    expect(bill).toMatchObject({ label: 'Tagihan lepas', status: 'OPEN', lines: [] });
    await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] });
    const after = (
      await req('POST', `/api/bills/${bill.id}/items`, {
        items: [{ productId: teh.id, qty: 2 }, { productId: stick.id, qty: 1 }, { custom: { name: 'Charger HP', price: 5000 }, qty: 1 }],
      })
    ).json();
    expect(after.lines.map((l: { type: string; name: string; qty: number; unitPrice: number }) => [l.type, l.name, l.qty, l.unitPrice])).toEqual([
      ['PRODUCT', 'Es Teh', 3, 8000],
      ['SERVICE', 'Sewa Stick', 1, 10000],
      ['CUSTOM', 'Charger HP', 1, 5000],
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'bill.custom_item' } })).toBe(1);
  });

  it('produk nonaktif ditolak; bill yang sudah bukan OPEN tidak bisa diubah', async () => {
    const bill = (await req('POST', '/api/bills')).json();
    await prisma.product.update({ where: { id: teh.id }, data: { active: false } });
    expect((await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] })).json().error.code).toBe('PRODUCT_INACTIVE');
    await prisma.bill.update({ where: { id: bill.id }, data: { status: 'PAID' } });
    expect((await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: stick.id, qty: 1 }] })).json().error.code).toBe('BILL_NOT_OPEN');
  });

  it('kasir: tambah qty bebas, kurangi qty & hapus butuh PIN', async () => {
    const bill = (await req('POST', '/api/bills')).json();
    const line = (await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 2 }] })).json().lines[0];
    expect((await req('PATCH', `/api/bills/${bill.id}/items/${line.id}`, { qty: 3 })).statusCode).toBe(200);
    expect((await req('PATCH', `/api/bills/${bill.id}/items/${line.id}`, { qty: 1 })).json().error.code).toBe('APPROVAL_REQUIRED');
    expect((await req('PATCH', `/api/bills/${bill.id}/items/${line.id}`, { qty: 1, approvalPin: '1111' })).json().lines[0].qty).toBe(1);
    expect((await req('DELETE', `/api/bills/${bill.id}/items/${line.id}`, {})).json().error.code).toBe('APPROVAL_REQUIRED');
    const del = await req('DELETE', `/api/bills/${bill.id}/items/${line.id}`, { approvalPin: '1111' });
    expect(del.json().lines).toEqual([]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'bill.remove_item' } });
    expect(log.approvedById).toBe(users.supervisor.id);
  });

  it('diskon item & bill tersimpan; baris TIME tidak bisa dihapus atau diubah qty', async () => {
    const billId = await playAndStop();
    const time = (await req('GET', `/api/bills/${billId}`)).json().lines[0];
    expect((await req('DELETE', `/api/bills/${billId}/items/${time.id}`, { approvalPin: '1111' })).json().error.code).toBe('LINE_LOCKED');
    expect((await req('PATCH', `/api/bills/${billId}/items/${time.id}`, { qty: 2 })).json().error.code).toBe('LINE_LOCKED');
    const d = await req('PATCH', `/api/bills/${billId}/items/${time.id}`, { discount: { type: 'PERCENT', value: 10 } });
    expect(d.json().lines[0].discount).toEqual({ type: 'PERCENT', value: 10 });
    const bd = await req('PUT', `/api/bills/${billId}/discount`, { discount: { type: 'AMOUNT', value: 5000 } });
    expect(bd.json().billDiscount).toEqual({ type: 'AMOUNT', value: 5000 });
    expect((await req('PUT', `/api/bills/${billId}/discount`, { discount: { type: 'PERCENT', value: 120 } })).statusCode).toBe(400);
  });
});

describe('batal & gabung', () => {
  it('batal: sesi aktif ditolak; bertagihan butuh PIN; kosong tidak', async () => {
    const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    expect((await req('POST', `/api/bills/${s.billId}/cancel`, { reason: 'salah meja' })).json().error.code).toBe('SESSION_ACTIVE');

    const billId = await playAndStop(b.m2.id);
    expect((await req('POST', `/api/bills/${billId}/cancel`, { reason: 'tes' })).json().error.code).toBe('APPROVAL_REQUIRED');
    const ok = await req('POST', `/api/bills/${billId}/cancel`, { reason: 'tes', approvalPin: '1111' });
    expect(ok.json()).toMatchObject({ status: 'CANCELLED', cancelReason: 'tes' });

    const empty = (await req('POST', '/api/bills')).json();
    expect((await req('POST', `/api/bills/${empty.id}/cancel`, { reason: 'tidak jadi' })).json().status).toBe('CANCELLED');
    expect((await req('POST', `/api/bills/${empty.id}/cancel`, { reason: '' })).statusCode).toBe(400);
  });

  it('gabung dua bill: baris & sesi pindah, sumber CANCELLED', async () => {
    const a = await playAndStop(b.m1.id);
    const running = (await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN' })).json().unit.session;
    const merged = await req('POST', `/api/bills/${a}/merge`, { sourceBillId: running.billId });
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toMatchObject({ label: 'Meja 1 + Meja 2' });
    expect(merged.json().activeSessions.map((x: { id: string }) => x.id)).toEqual([running.id]);
    const source = await prisma.bill.findUniqueOrThrow({ where: { id: running.billId } });
    expect(source).toMatchObject({ status: 'CANCELLED', mergedIntoId: a });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: running.id } })).billId).toBe(a);

    expect((await req('POST', `/api/bills/${a}/merge`, { sourceBillId: a })).json().error.code).toBe('SAME_BILL');
    expect((await req('POST', `/api/bills/${a}/merge`, { sourceBillId: running.billId })).json().error.code).toBe('BILL_NOT_OPEN');
  });

  it('daftar: filter status & cari nomor', async () => {
    const a = await playAndStop(b.m1.id);
    await req('POST', '/api/bills');
    const open = (await req('GET', '/api/bills?status=OPEN')).json();
    expect(open).toHaveLength(2);
    expect(open.find((x: { id: string }) => x.id === a)).toMatchObject({ total: 40000, hasActiveSession: false, label: 'Meja 1' });
    const found = (await req('GET', '/api/bills?q=0001')).json();
    expect(found.map((x: { id: string }) => x.id)).toEqual([a]);
  });
});

describe('konkurensi & shift (perbaikan review)', () => {
  it('hapus item tanpa shift → NO_OPEN_SHIFT', async () => {
    const bill = (await req('POST', '/api/bills')).json();
    const line = (await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] })).json().lines[0];
    await prisma.shift.updateMany({ data: { openFlag: null, closedAt: new Date() } });
    const res = await req('DELETE', `/api/bills/${bill.id}/items/${line.id}`, { approvalPin: '1111' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_OPEN_SHIFT');
  });

  it('batal bill bertagihan tanpa PIN ditolak, bill tetap OPEN', async () => {
    const bill = (await req('POST', '/api/bills')).json();
    await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] });
    const res = await req('POST', `/api/bills/${bill.id}/cancel`, { reason: 'tes' });
    expect(res.json().error.code).toBe('APPROVAL_REQUIRED');
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe('OPEN');
  });

  it('batal berbarengan dengan tambah item: bill CANCELLED tidak pernah berisi item tanpa PIN', async () => {
    const bill = (await req('POST', '/api/bills')).json();
    const [c, a] = await Promise.all([
      req('POST', `/api/bills/${bill.id}/cancel`, { reason: 'tes' }),
      req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] }),
    ]);
    expect(c.statusCode).toBeLessThan(500);
    expect(a.statusCode).toBeLessThan(500);
    const row = await prisma.bill.findUniqueOrThrow({ where: { id: bill.id }, include: { lines: true } });
    if (row.status === 'CANCELLED') expect(row.lines).toHaveLength(0);
  });

  it('stop dan gabung berbarengan: tidak deadlock/500, state konsisten', async () => {
    const a = await playAndStop(b.m1.id);
    const running = (await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN' })).json().unit.session;
    t.clock.advanceMinutes(30);
    const [stop, merge] = await Promise.all([
      req('POST', `/api/sessions/${running.id}/stop`, {}),
      req('POST', `/api/bills/${a}/merge`, { sourceBillId: running.billId }),
    ]);
    expect(stop.statusCode).toBeLessThan(500);
    expect(merge.statusCode).toBeLessThan(500);
    const sess = await prisma.session.findUniqueOrThrow({ where: { id: running.id } });
    const timeLines = await prisma.billLine.findMany({ where: { sessionId: running.id } });
    expect(timeLines).toHaveLength(sess.status === 'ENDED' ? 1 : 0);
    if (merge.statusCode === 200) {
      expect(sess.billId).toBe(a);
      expect(timeLines.every((l) => l.billId === a)).toBe(true);
    }
  });
});
