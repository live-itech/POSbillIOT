import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const openShift = (openingCash = 200000) => req('POST', '/api/shifts', { openingCash });

describe('buka & tutup shift', () => {
  it('buka shift → current berisi ringkasan dengan kas seharusnya = kas awal', async () => {
    expect((await req('GET', '/api/shifts/current')).json()).toEqual({ summary: null });
    const res = await openShift();
    expect(res.statusCode).toBe(200);
    const summary = res.json().summary;
    expect(summary.shift).toMatchObject({ openingCash: 200000, openedByName: 'kasir', closedAt: null });
    expect(summary).toMatchObject({ expectedCash: 200000, billCount: 0, sales: { CASH: 0, QRIS: 0, CARD: 0, TRANSFER: 0 } });
    expect((await req('GET', '/api/shifts/current')).json().summary.shift.id).toBe(summary.shift.id);
  });

  it('shift kedua ditolak, termasuk saat dibuka bersamaan', async () => {
    const [a, c] = await Promise.all([openShift(), openShift()]);
    expect([a.statusCode, c.statusCode].sort()).toEqual([200, 409]);
    expect([a, c].find((r) => r.statusCode === 409)!.json().error.code).toBe('SHIFT_ALREADY_OPEN');
    expect(await prisma.shift.count()).toBe(1);
  });

  it('tutup shift menyimpan kas dihitung & seharusnya; tutup lagi → NO_OPEN_SHIFT', async () => {
    await openShift(150000);
    const res = await req('POST', '/api/shifts/current/close', { countedCash: 145000, note: 'kurang receh' });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.shift).toMatchObject({ countedCash: 145000, expectedCash: 150000, note: 'kurang receh', closedByName: 'kasir' });
    expect((await req('GET', '/api/shifts/current')).json()).toEqual({ summary: null });
    const again = await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('NO_OPEN_SHIFT');
    const list = (await req('GET', '/api/shifts')).json();
    expect(list).toHaveLength(1);
    expect(list[0].closedAt).not.toBeNull();
  });

  it('kas awal negatif ditolak', async () => {
    expect((await openShift(-1)).statusCode).toBe(400);
  });
});

describe('shift dan sesi', () => {
  it('mulai sesi tanpa shift → 409 NO_OPEN_SHIFT', async () => {
    const res = await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_OPEN_SHIFT');
  });

  it('dengan shift: sesi mulai dan bill diberi label nama meja', async () => {
    await openShift();
    const res = await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(200);
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: res.json().unit.session.billId } });
    expect(bill.label).toBe('Meja 1');
  });

  it('meja yang sedang jalan tetap bisa di-stop setelah shift ditutup', async () => {
    await openShift();
    const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    await req('POST', '/api/shifts/current/close', { countedCash: 200000 });
    t.clock.advanceMinutes(30);
    expect((await req('POST', `/api/sessions/${s.id}/stop`, {})).statusCode).toBe(200);
  });
});
