import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  const users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id);
  t = await makeApp(); // Kamis 1 Okt 2026 10:00 WIB
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
/** Default: Meja 2, 19:00–20:00 WIB. */
const book = (over: Record<string, unknown> = {}) =>
  req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T12:00:00.000Z', durationMin: 60, customerName: 'Budi', phone: '0812', ...over });

describe('buat booking', () => {
  it('tanpa DP: BOOKED, tanpa bill, diaudit', async () => {
    const res = await book();
    expect(res.statusCode).toBe(200);
    expect(res.json().depositBillId).toBeNull();
    expect(res.json().booking).toMatchObject({
      unitId: b.m2.id, unitName: 'Meja 2', customerName: 'Budi', phone: '0812', startAt: '2026-10-01T12:00:00.000Z', durationMin: 60,
      status: 'BOOKED', depositAmount: 0, depositBillId: null, depositBillStatus: null, depositOutcome: null, createdByName: 'kasir',
    });
    expect(await prisma.bill.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'booking.create' } })).toBe(1);
  });

  it('bentrok di meja yang sama ditolak; bersebelahan, meja lain, dan booking batal tidak dihitung', async () => {
    expect((await book()).statusCode).toBe(200);
    const clash = await book({ startAt: '2026-10-01T12:30:00.000Z' });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error).toMatchObject({ code: 'BOOKING_CONFLICT', message: 'Jadwal bentrok dengan booking Budi jam 19:00' });
    expect((await book({ startAt: '2026-10-01T11:30:00.000Z', durationMin: 30 })).statusCode).toBe(200); // 18:30–19:00
    expect((await book({ startAt: '2026-10-01T13:00:00.000Z' })).statusCode).toBe(200); // 20:00–21:00
    expect((await book({ unitId: b.m1.id, startAt: '2026-10-01T12:30:00.000Z' })).statusCode).toBe(200);
    await prisma.booking.updateMany({ where: { unitId: b.m1.id }, data: { status: 'CANCELLED' } });
    expect((await book({ unitId: b.m1.id })).statusCode).toBe(200);
  });

  it('dua booking bentrok paralel → tepat satu berhasil', async () => {
    const [x, y] = await Promise.all([book(), book({ customerName: 'Rina' })]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.booking.count()).toBe(1);
  });

  it('DP > 0: bill DEPOSIT OPEN satu baris; dibayar lewat checkout; DP butuh shift', async () => {
    const res = await book({ depositAmount: 50000 });
    const depId = res.json().depositBillId as string;
    expect(res.json().booking).toMatchObject({ depositAmount: 50000, depositBillId: depId, depositBillStatus: 'OPEN' });
    const bill = (await req('GET', `/api/bills/${depId}`)).json();
    expect(bill).toMatchObject({ kind: 'DEPOSIT', label: 'DP · Budi · Meja 2 19:00', status: 'OPEN', member: null });
    expect(bill.lines).toEqual([expect.objectContaining({ type: 'DEPOSIT', name: 'DP booking Meja 2 01/10/2026 19:00', unitPrice: 50000, qty: 1 })]);
    expect((await req('POST', `/api/bills/${depId}/items`, { items: [{ custom: { name: 'x', price: 1000 }, qty: 1 }] })).json().error.code).toBe('DEPOSIT_BILL_LOCKED');
    const paid = await req('POST', `/api/bills/${depId}/checkout`, { idempotencyKey: 'dp-0000001', expectedGrandTotal: 50000, payments: [{ method: 'CASH', amount: 50000 }] });
    expect(paid.statusCode).toBe(200);
    expect((await req('GET', `/api/bookings/${res.json().booking.id}`)).json().depositBillStatus).toBe('PAID');

    await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect((await book({ unitId: b.m1.id, depositAmount: 10000 })).json().error.code).toBe('NO_OPEN_SHIFT');
    expect((await book({ unitId: b.m1.id })).statusCode).toBe(200);
  });

  it('booking untuk member: nama & HP dari member', async () => {
    const lv = await prisma.memberLevel.create({ data: { name: 'Gold', timeDiscountPct: 10 } });
    const m = await prisma.member.create({ data: { code: 'M0001', name: 'Sinta', phone: '0811', levelId: lv.id } });
    const res = await book({ customerName: undefined, phone: undefined, memberId: m.id });
    expect(res.json().booking).toMatchObject({ customerName: 'Sinta', phone: '0811', memberId: m.id, memberCode: 'M0001' });
  });

  it('validasi: jadwal lewat, nama kosong, durasi, meja maintenance', async () => {
    expect((await book({ startAt: '2026-10-01T01:00:00.000Z' })).json().error.code).toBe('BOOKING_IN_PAST'); // 08:00–09:00
    expect((await book({ customerName: '', startAt: '2026-10-01T15:00:00.000Z' })).json().error.code).toBe('CUSTOMER_REQUIRED');
    expect((await book({ durationMin: 10 })).statusCode).toBe(400);
    await prisma.unit.update({ where: { id: b.m1.id }, data: { state: 'MAINTENANCE' } });
    expect((await book({ unitId: b.m1.id })).json().error.code).toBe('UNIT_MAINTENANCE');
  });
});

describe('ubah jadwal & daftar', () => {
  it('hanya BOOKED; bentrok diperiksa ulang', async () => {
    const a = (await book()).json().booking;
    const c = (await book({ startAt: '2026-10-01T14:00:00.000Z', customerName: 'Rina' })).json().booking; // 21:00
    expect((await req('PATCH', `/api/bookings/${c.id}`, { startAt: '2026-10-01T12:30:00.000Z' })).json().error.code).toBe('BOOKING_CONFLICT');
    expect((await req('PATCH', `/api/bookings/${c.id}`, { startAt: '2026-10-01T13:00:00.000Z' })).json()).toMatchObject({ startAt: '2026-10-01T13:00:00.000Z' });
    expect((await req('PATCH', `/api/bookings/${a.id}`, { unitId: b.m1.id, note: 'dekat jendela' })).json()).toMatchObject({ unitName: 'Meja 1', note: 'dekat jendela' });
    await prisma.booking.update({ where: { id: a.id }, data: { status: 'CANCELLED' } });
    expect((await req('PATCH', `/api/bookings/${a.id}`, { durationMin: 90 })).json().error.code).toBe('BOOKING_NOT_ACTIVE');
  });

  it('daftar per hari lokal outlet', async () => {
    await book();
    await book({ startAt: '2026-10-02T03:00:00.000Z' });
    const day = await req('GET', '/api/bookings?from=2026-09-30T17:00:00.000Z&to=2026-10-01T17:00:00.000Z');
    expect(day.json().map((x: { startAt: string }) => x.startAt)).toEqual(['2026-10-01T12:00:00.000Z']);
  });
});
