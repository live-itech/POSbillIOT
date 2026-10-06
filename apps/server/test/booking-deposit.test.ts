import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  const users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id, 100000);
  t = await makeApp(); // 10:00 WIB
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const pay = (billId: string, total: number, payments: unknown[], key = 'key-0000001') =>
  req('POST', `/api/bills/${billId}/checkout`, { idempotencyKey: key, expectedGrandTotal: total, payments });
const bookingRow = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });

/** Booking Meja 2 10:30, DP tunai dibayar (bila > 0), check-in 10:15, main 60 menit lalu stop → bill penjualan Rp40.000. */
async function checkedIn(deposit: number) {
  const created = (await req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', depositAmount: deposit })).json();
  if (deposit > 0) expect((await pay(created.depositBillId, deposit, [{ method: 'CASH', amount: deposit }], `dp-${created.booking.id}`)).statusCode).toBe(200);
  t.clock.advanceMinutes(15);
  const ci = await req('POST', `/api/bookings/${created.booking.id}/check-in`, { mode: 'OPEN' });
  expect(ci.statusCode).toBe(200);
  const session = ci.json().unit.session;
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${session.id}/stop`, {});
  return { bookingId: created.booking.id as string, saleBillId: session.billId as string, depositBillId: created.depositBillId as string | null };
}

const DP_30_PLUS_CASH = [{ method: 'DEPOSIT', amount: 30000, received: 30000 }, { method: 'CASH', amount: 10000 }];

describe('checkout dengan DP booking', () => {
  it('DP < total: DEPOSIT dipakai + tunai, booking USED', async () => {
    const x = await checkedIn(30000);
    expect((await req('GET', `/api/bills/${x.saleBillId}`)).json().booking).toEqual({
      id: x.bookingId, customerName: 'Budi', startAt: '2026-10-01T03:30:00.000Z', status: 'CHECKED_IN', deposit: { amount: 30000, available: true },
    });
    const res = await pay(x.saleBillId, 40000, DP_30_PLUS_CASH);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ change: 0, depositChange: 0 });
    expect(await bookingRow(x.bookingId)).toMatchObject({ depositOutcome: 'USED', depositUsedAmount: 30000 });
    expect((await req('GET', `/api/bills/${x.saleBillId}`)).json().booking.deposit).toEqual({ amount: 30000, available: false });
  });

  it('DP > total: amount = total, kembalian DP dicatat', async () => {
    const x = await checkedIn(50000);
    const res = await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 40000, received: 50000 }]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ change: 0, depositChange: 10000 });
    expect(await prisma.payment.findFirstOrThrow({ where: { billId: x.saleBillId } })).toMatchObject({ method: 'DEPOSIT', amount: 40000, received: 50000, change: 10000 });
    expect((await bookingRow(x.bookingId)).depositUsedAmount).toBe(40000);
  });

  it('nominal DP salah, bill tanpa booking, atau bill DP → PAYMENT_INVALID', async () => {
    const x = await checkedIn(50000);
    expect((await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 50000, received: 50000 }])).json().error.code).toBe('PAYMENT_INVALID');
    expect((await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 40000, received: 40000 }])).json().error.code).toBe('PAYMENT_INVALID');
    const loose = (await req('POST', '/api/bills')).json();
    await req('POST', `/api/bills/${loose.id}/items`, { items: [{ custom: { name: 'Sewa stik', price: 10000 }, qty: 1 }] });
    expect((await pay(loose.id, 10000, [{ method: 'DEPOSIT', amount: 10000 }], 'key-0000002')).json().error.code).toBe('PAYMENT_INVALID');
    const other = (await req('POST', '/api/bookings', { unitId: b.m1.id, startAt: '2026-10-01T05:00:00.000Z', durationMin: 60, customerName: 'Rina', depositAmount: 20000 })).json();
    expect((await pay(other.depositBillId, 20000, [{ method: 'DEPOSIT', amount: 20000 }], 'key-0000003')).json().error.code).toBe('PAYMENT_INVALID');
    expect((await bookingRow(x.bookingId)).depositOutcome).toBeNull();
  });

  it('DP belum dibayar saat check-in → DEPOSIT ditolak DEPOSIT_NOT_AVAILABLE', async () => {
    const created = (await req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', depositAmount: 20000 })).json();
    t.clock.advanceMinutes(15);
    const session = (await req('POST', `/api/bookings/${created.booking.id}/check-in`, { mode: 'OPEN' })).json().unit.session;
    t.clock.advanceMinutes(60);
    await req('POST', `/api/sessions/${session.id}/stop`, {});
    expect((await req('GET', `/api/bills/${session.billId}`)).json().booking.deposit).toEqual({ amount: 20000, available: false });
    const res = await pay(session.billId, 40000, [{ method: 'DEPOSIT', amount: 20000, received: 20000 }, { method: 'CASH', amount: 20000 }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DEPOSIT_NOT_AVAILABLE');
  });

  it('checkout ulang dengan key sama (juga paralel) tidak mengulang efek DP', async () => {
    const x = await checkedIn(30000);
    const [a, c] = await Promise.all([pay(x.saleBillId, 40000, DP_30_PLUS_CASH), pay(x.saleBillId, 40000, DP_30_PLUS_CASH)]);
    expect([a.statusCode, c.statusCode]).toEqual([200, 200]);
    const again = await pay(x.saleBillId, 40000, DP_30_PLUS_CASH);
    expect(again.json()).toMatchObject({ change: 0, depositChange: 0, bill: { status: 'PAID' } });
    expect(await prisma.payment.count({ where: { billId: x.saleBillId } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'bill.paid', entityId: x.saleBillId } })).toBe(1);
    expect((await bookingRow(x.bookingId)).depositUsedAmount).toBe(30000);
  });
});

describe('void & gabung dengan DP', () => {
  it('void bill penjualan ber-DP: DP dikembalikan tunai, booking REFUNDED', async () => {
    const x = await checkedIn(30000);
    await pay(x.saleBillId, 40000, DP_30_PLUS_CASH);
    expect((await req('POST', `/api/bills/${x.saleBillId}/void`, { reason: 'salah meja', approvalPin: '1111' })).statusCode).toBe(200);
    expect((await bookingRow(x.bookingId)).depositOutcome).toBe('REFUNDED');
    expect((await req('GET', '/api/shifts/current')).json().summary.voids).toMatchObject({ DEPOSIT: 30000, CASH: 10000 });
  });

  it('void bill DP: sebelum dipakai → REFUNDED; sesudah dipakai → DEPOSIT_USED', async () => {
    const early = (await req('POST', '/api/bookings', { unitId: b.m1.id, startAt: '2026-10-01T05:00:00.000Z', durationMin: 60, customerName: 'Rina', depositAmount: 20000 })).json();
    await pay(early.depositBillId, 20000, [{ method: 'CASH', amount: 20000 }], 'dp-rina-0001');
    expect((await req('POST', `/api/bills/${early.depositBillId}/void`, { reason: 'batal', approvalPin: '1111' })).statusCode).toBe(200);
    expect(await bookingRow(early.booking.id)).toMatchObject({ status: 'BOOKED', depositOutcome: 'REFUNDED' });

    const x = await checkedIn(30000);
    await pay(x.saleBillId, 40000, DP_30_PLUS_CASH);
    const res = await req('POST', `/api/bills/${x.depositBillId}/void`, { reason: 'x', approvalPin: '1111' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DEPOSIT_USED');
  });

  it('gabung bill booking: booking pindah ke target; dua booking → MERGE_CONFLICT; DP dipakai di target', async () => {
    const x = await checkedIn(30000); // jam 11:15
    const a = (await req('POST', '/api/bills')).json();
    await req('POST', `/api/bills/${a.id}/items`, { items: [{ custom: { name: 'Sewa stik', price: 10000 }, qty: 1 }] });
    const merged = await req('POST', `/api/bills/${a.id}/merge`, { sourceBillId: x.saleBillId });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().booking).toMatchObject({ id: x.bookingId, deposit: { amount: 30000, available: true } });
    expect((await bookingRow(x.bookingId)).saleBillId).toBe(a.id);

    const second = (await req('POST', '/api/bookings', { unitId: b.m1.id, startAt: '2026-10-01T04:30:00.000Z', durationMin: 60, customerName: 'Rina' })).json(); // 11:30
    const s2 = (await req('POST', `/api/bookings/${second.booking.id}/check-in`, { mode: 'OPEN' })).json().unit.session;
    expect((await req('POST', `/api/bills/${a.id}/merge`, { sourceBillId: s2.billId })).json().error.code).toBe('MERGE_CONFLICT');

    const res = await pay(a.id, 50000, [{ method: 'DEPOSIT', amount: 30000, received: 30000 }, { method: 'CASH', amount: 20000 }]);
    expect(res.statusCode).toBe(200);
    expect((await bookingRow(x.bookingId)).depositOutcome).toBe('USED');
  });
});
