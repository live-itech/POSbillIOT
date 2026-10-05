import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;
let teh: { id: string };
let shiftId: string;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  shiftId = (await openShift(users.kasir.id, 100000)).id;
  const cat = await prisma.category.create({ data: { name: 'Minuman' } });
  teh = await prisma.product.create({ data: { name: 'Es Teh', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 10 } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });

/** Meja 1 open billing 60 menit (Rp40.000) + 2 Es Teh (Rp16.000) = Rp56.000. */
async function readyBill(): Promise<string> {
  const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
  await req('POST', `/api/bills/${s.billId}/items`, { items: [{ productId: teh.id, qty: 2 }] });
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${s.id}/stop`, {});
  return s.billId;
}

const pay = (billId: string, body: Record<string, unknown>) =>
  req('POST', `/api/bills/${billId}/checkout`, { idempotencyKey: 'key-0000001', expectedGrandTotal: 56000, payments: [{ method: 'CASH', amount: 56000, received: 100000 }], ...body });

describe('checkout', () => {
  it('split tunai + QRIS: PAID, stok berkurang, rekap shift', async () => {
    const billId = await readyBill();
    const res = await pay(billId, { payments: [{ method: 'CASH', amount: 30000, received: 50000 }, { method: 'QRIS', amount: 26000, reference: 'QR-1' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().change).toBe(20000);
    expect(res.json().bill).toMatchObject({ status: 'PAID', shiftId, stored: { subtotal: 56000, grandTotal: 56000 } });
    expect(res.json().bill.payments).toHaveLength(2);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: teh.id } })).stockQty).toBe(8);
    expect(await prisma.stockMovement.findMany({ select: { qty: true, reason: true } })).toEqual([{ qty: -2, reason: 'SALE' }]);
    const summary = (await req('GET', '/api/shifts/current')).json().summary;
    expect(summary).toMatchObject({ sales: { CASH: 30000, QRIS: 26000 }, expectedCash: 130000, billCount: 1 });
  });

  it('total berubah dari perangkat lain → TOTAL_CHANGED, tidak ada pembayaran', async () => {
    const billId = await readyBill();
    await req('POST', `/api/bills/${billId}/items`, { items: [{ productId: teh.id, qty: 1 }] });
    const res = await pay(billId, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TOTAL_CHANGED');
    expect(await prisma.payment.count()).toBe(0);
  });

  it('idempotency: key sama dua kali → hasil sama, pembayaran tidak ganda', async () => {
    const billId = await readyBill();
    const a = await pay(billId, {});
    const c = await pay(billId, {});
    expect(c.statusCode).toBe(200);
    expect(c.json().bill.id).toBe(a.json().bill.id);
    expect(c.json().change).toBe(44000);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('checkout paralel dengan key berbeda → tepat satu berhasil', async () => {
    const billId = await readyBill();
    const [x, y] = await Promise.all([pay(billId, { idempotencyKey: 'key-aaaaaaa' }), pay(billId, { idempotencyKey: 'key-bbbbbbb' })]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.statusCode === 409)!.json().error.code).toBe('BILL_NOT_OPEN');
    expect(await prisma.payment.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: teh.id } })).stockQty).toBe(8);
  });

  it('checkout paralel dengan key sama → keduanya 200, satu set pembayaran', async () => {
    const billId = await readyBill();
    const [x, y] = await Promise.all([pay(billId, {}), pay(billId, {})]);
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('key yang sudah dipakai bill lain → REQUEST_ID_USED', async () => {
    const billId = await readyBill();
    await pay(billId, {});
    const other = (await req('POST', '/api/bills')).json();
    await req('POST', `/api/bills/${other.id}/items`, { items: [{ productId: teh.id, qty: 1 }] });
    const res = await req('POST', `/api/bills/${other.id}/checkout`, { idempotencyKey: 'key-0000001', expectedGrandTotal: 8000, payments: [{ method: 'CASH', amount: 8000 }] });
    expect(res.json().error.code).toBe('REQUEST_ID_USED');
  });

  it('sesi masih berjalan, tanpa shift, bill kosong, pembayaran kurang', async () => {
    const s = (await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN' })).json().unit.session;
    expect((await pay(s.billId, {})).json().error.code).toBe('SESSION_ACTIVE');
    const empty = (await req('POST', '/api/bills')).json();
    expect((await pay(empty.id, { expectedGrandTotal: 0, payments: [] })).json().error.code).toBe('BILL_EMPTY');
    const billId = await readyBill();
    expect((await pay(billId, { payments: [{ method: 'CARD', amount: 50000 }] })).json().error.code).toBe('PAYMENT_INSUFFICIENT');
    await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect((await pay(billId, {})).json().error.code).toBe('NO_OPEN_SHIFT');
  });

  it('diskon di atas batas: kasir butuh PIN; sesuai batas tidak', async () => {
    const billId = await readyBill();
    await req('PUT', `/api/bills/${billId}/discount`, { discount: { type: 'PERCENT', value: 20 } });
    const body = { expectedGrandTotal: 44800, payments: [{ method: 'CASH', amount: 44800 }] };
    expect((await pay(billId, body)).json().error.code).toBe('APPROVAL_REQUIRED');
    const ok = await pay(billId, { ...body, approvalPin: '1111' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().bill.stored).toMatchObject({ discountTotal: 11200, grandTotal: 44800 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'bill.paid' } });
    expect(log.approvedById).toBe(users.supervisor.id);

    const other = await readyBillOn(b.m2.id);
    await req('PUT', `/api/bills/${other}/discount`, { discount: { type: 'PERCENT', value: 10 } });
    expect((await pay(other, { idempotencyKey: 'key-0000002', expectedGrandTotal: 50400, payments: [{ method: 'CASH', amount: 50400 }] })).statusCode).toBe(200);
  });

  it('pajak & service dari pengaturan masuk ke total tersimpan', async () => {
    await prisma.setting.update({ where: { id: 1 }, data: { taxPct: 10, taxScope: 'ALL', servicePct: 5, serviceScope: 'FNB' } });
    const billId = await readyBill();
    // service 5% × 16000 = 800; pajak 10% × (56000 + 800) = 5680 → 62480
    const res = await pay(billId, { expectedGrandTotal: 62480, payments: [{ method: 'CARD', amount: 62480 }] });
    expect(res.json().bill.stored).toEqual({ subtotal: 56000, discountTotal: 0, serviceTotal: 800, taxTotal: 5680, grandTotal: 62480 });
  });

  it('bill dari shift lama dibayar di shift baru → masuk rekap shift baru', async () => {
    const billId = await readyBill();
    await req('POST', '/api/shifts/current/close', { countedCash: 100000 });
    const next = (await req('POST', '/api/shifts', { openingCash: 50000 })).json().summary.shift.id;
    await pay(billId, { payments: [{ method: 'CASH', amount: 56000 }] });
    expect((await prisma.payment.findFirstOrThrow()).shiftId).toBe(next);
    expect((await req('GET', `/api/shifts/${shiftId}`)).json()).toMatchObject({ sales: { CASH: 0 }, expectedCash: 100000 });
    expect((await req('GET', `/api/shifts/${next}`)).json()).toMatchObject({ sales: { CASH: 56000 }, expectedCash: 106000 });
  });
});

async function readyBillOn(unitId: string): Promise<string> {
  t.clock.set(new Date('2026-10-01T03:00:00Z'));
  const s = (await req('POST', '/api/sessions', { unitId, mode: 'OPEN' })).json().unit.session;
  await req('POST', `/api/bills/${s.billId}/items`, { items: [{ productId: teh.id, qty: 2 }] });
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${s.id}/stop`, {});
  return s.billId;
}

describe('void', () => {
  it('kasir butuh PIN; stok kembali tepat sekali; rekap shift dikurangi', async () => {
    const billId = await readyBill();
    await pay(billId, { payments: [{ method: 'CASH', amount: 56000, received: 60000 }] });
    expect((await req('POST', `/api/bills/${billId}/void`, { reason: 'salah input' })).json().error.code).toBe('APPROVAL_REQUIRED');
    const [x, y] = await Promise.all([
      req('POST', `/api/bills/${billId}/void`, { reason: 'salah input', approvalPin: '1111' }),
      req('POST', `/api/bills/${billId}/void`, { reason: 'salah input', approvalPin: '1111' }),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.statusCode === 409)!.json().error.code).toBe('BILL_NOT_PAID');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: teh.id } })).stockQty).toBe(10);
    expect(await prisma.stockMovement.count({ where: { reason: 'VOID' } })).toBe(1);
    const bill = (await req('GET', `/api/bills/${billId}`)).json();
    expect(bill).toMatchObject({ status: 'VOID', voidReason: 'salah input' });
    const summary = (await req('GET', '/api/shifts/current')).json().summary;
    expect(summary).toMatchObject({ sales: { CASH: 56000 }, voids: { CASH: 56000 }, voidCount: 1, expectedCash: 100000 });
  });

  it('bill OPEN tidak bisa di-void', async () => {
    const billId = await readyBill();
    expect((await req('POST', `/api/bills/${billId}/void`, { reason: 'x', approvalPin: '1111' })).json().error.code).toBe('BILL_NOT_PAID');
  });
});
