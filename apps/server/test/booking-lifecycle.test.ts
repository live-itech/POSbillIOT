import type { AlertEvent } from '@funplay/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;
let alerts: AlertEvent[];

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id, 100000);
  t = await makeApp(); // 10:00 WIB
  cookie = await loginAs(t.app, 'kasir');
  alerts = [];
  t.ctx.bus.on('alert', (a) => alerts.push(a));
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
/** Meja 2, 10:30–11:30 WIB. */
const book = (over: Record<string, unknown> = {}) =>
  req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', ...over });
async function bookWithPaidDp(amount = 50000, over: Record<string, unknown> = {}) {
  const r = (await book({ depositAmount: amount, ...over })).json();
  const p = await req('POST', `/api/bills/${r.depositBillId}/checkout`, { idempotencyKey: `dp-${r.booking.id}`, expectedGrandTotal: amount, payments: [{ method: 'CASH', amount }] });
  expect(p.statusCode).toBe(200);
  return { id: r.booking.id as string, depositBillId: r.depositBillId as string };
}
const cancel = (id: string, body: Record<string, unknown>) => req('POST', `/api/bookings/${id}/cancel`, body);
const refund = (id: string, body: Record<string, unknown>) => req('POST', `/api/bookings/${id}/refund-deposit`, body);
const summary = async () => (await req('GET', '/api/shifts/current')).json().summary;

describe('batal booking', () => {
  it('tanpa DP: tanpa PIN, alasan wajib, hanya sekali', async () => {
    const id = (await book()).json().booking.id;
    expect((await cancel(id, { reason: '' })).statusCode).toBe(400);
    expect((await cancel(id, { reason: 'tidak jadi' })).json()).toMatchObject({ status: 'CANCELLED', cancelReason: 'tidak jadi', depositOutcome: null });
    expect((await cancel(id, { reason: 'lagi' })).json().error.code).toBe('BOOKING_NOT_ACTIVE');
  });

  it('ber-DP: kasir butuh PIN; DP hangus tidak mengubah kas', async () => {
    const bk = await bookWithPaidDp();
    expect((await cancel(bk.id, { reason: 'batal', deposit: 'FORFEIT' })).json().error.code).toBe('APPROVAL_REQUIRED');
    const ok = await cancel(bk.id, { reason: 'batal', deposit: 'FORFEIT', approvalPin: '1111' });
    expect(ok.json()).toMatchObject({ status: 'CANCELLED', depositOutcome: 'FORFEITED', depositBillStatus: 'PAID' });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'booking.cancel' } })).approvedById).toBe(users.supervisor.id);
    expect(await summary()).toMatchObject({ sales: { CASH: 50000 }, voids: { CASH: 0 }, expectedCash: 150000 });
  });

  it('ber-DP dengan REFUND: bill DP di-void, kas berkurang', async () => {
    const bk = await bookWithPaidDp();
    const ok = await cancel(bk.id, { reason: 'hujan', deposit: 'REFUND', approvalPin: '1111' });
    expect(ok.json()).toMatchObject({ status: 'CANCELLED', depositOutcome: 'REFUNDED', depositBillStatus: 'VOID' });
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } })).toMatchObject({ status: 'VOID', voidReason: 'Booking dibatalkan: hujan' });
    expect(await summary()).toMatchObject({ voids: { CASH: 50000 }, expectedCash: 100000 });
  });

  it('bill DP masih OPEN ikut dibatalkan, tanpa PIN', async () => {
    const r = (await book({ depositAmount: 50000 })).json();
    expect((await cancel(r.booking.id, { reason: 'tidak jadi' })).statusCode).toBe(200);
    expect(await prisma.bill.findUniqueOrThrow({ where: { id: r.depositBillId } })).toMatchObject({ status: 'CANCELLED', cancelReason: 'Booking dibatalkan: tidak jadi' });
  });
});

describe('scheduler booking', () => {
  it('notifikasi booking akan datang sekali saat hold dimulai', async () => {
    await book();
    await t.ctx.scheduler.tick();
    expect(alerts).toHaveLength(0);
    t.clock.advanceMinutes(15);
    await t.ctx.scheduler.tick();
    await t.ctx.scheduler.tick();
    expect(alerts).toEqual([expect.objectContaining({ type: 'BOOKING_UPCOMING', level: 'info', unitId: b.m2.id, message: 'Booking Budi di Meja 2 jam 10:30' })]);
  });

  it('no-show otomatis menurut clock: DP hangus, bill DP OPEN dibatalkan, notifikasi', async () => {
    const paid = await bookWithPaidDp();
    const open = (await book({ unitId: b.m1.id, depositAmount: 20000, customerName: 'Rina' })).json();
    t.clock.advanceMinutes(44); // 10:44
    await t.ctx.scheduler.tick();
    expect(await prisma.booking.count({ where: { status: 'BOOKED' } })).toBe(2);
    t.clock.advanceMinutes(1); // 10:45 = jadwal + 15 menit
    await t.ctx.scheduler.tick();
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ status: 'NO_SHOW', depositOutcome: 'FORFEITED' });
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: open.booking.id } })).toMatchObject({ status: 'NO_SHOW', depositOutcome: null });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: open.depositBillId } })).status).toBe('CANCELLED');
    expect(alerts.filter((a) => a.type === 'BOOKING_NO_SHOW').map((a) => a.message).sort()).toEqual([
      'No-show: Budi di Meja 2 jam 10:30',
      'No-show: Rina di Meja 1 jam 10:30',
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'booking.no_show', userId: null } })).toBe(2);
  });

  it('kembalikan DP setelah no-show: PIN untuk kasir, hanya sekali', async () => {
    const bk = await bookWithPaidDp();
    t.clock.advanceMinutes(45);
    await t.ctx.scheduler.tick();
    expect((await refund(bk.id, { reason: 'sakit' })).json().error.code).toBe('APPROVAL_REQUIRED');
    const ok = await refund(bk.id, { reason: 'sakit', approvalPin: '1111' });
    expect(ok.json()).toMatchObject({ status: 'NO_SHOW', depositOutcome: 'REFUNDED', depositBillStatus: 'VOID' });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } })).voidReason).toBe('Pengembalian DP: sakit');
    expect((await refund(bk.id, { reason: 'sakit', approvalPin: '1111' })).json().error.code).toBe('DEPOSIT_NOT_AVAILABLE');
  });

  it('check-in dan scheduler bersamaan pada batas no-show → satu menang', async () => {
    const id = (await book()).json().booking.id;
    t.clock.advanceMinutes(45);
    const [, ci] = await Promise.all([t.ctx.scheduler.tick(), req('POST', `/api/bookings/${id}/check-in`, { mode: 'OPEN' })]);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id } });
    if (ci.statusCode === 200) {
      expect(row.status).toBe('CHECKED_IN');
      expect(await prisma.auditLog.count({ where: { action: 'booking.no_show' } })).toBe(0);
    } else {
      expect(ci.json().error.code).toBe('BOOKING_NOT_ACTIVE');
      expect(row.status).toBe('NO_SHOW');
      expect(await prisma.session.count()).toBe(0);
    }
  });

  it('DP dipakai dan dikembalikan bersamaan → hanya satu berhasil', async () => {
    const bk = await bookWithPaidDp(30000);
    t.clock.advanceMinutes(15);
    const session = (await req('POST', `/api/bookings/${bk.id}/check-in`, { mode: 'OPEN' })).json().unit.session;
    t.clock.advanceMinutes(60);
    await req('POST', `/api/sessions/${session.id}/stop`, {});
    const [payRes, refundRes] = await Promise.all([
      req('POST', `/api/bills/${session.billId}/checkout`, {
        idempotencyKey: 'key-race-0001', expectedGrandTotal: 40000,
        payments: [{ method: 'DEPOSIT', amount: 30000, received: 30000 }, { method: 'CASH', amount: 10000 }],
      }),
      refund(bk.id, { reason: 'minta tunai', approvalPin: '1111' }),
    ]);
    expect([payRes.statusCode, refundRes.statusCode].sort()).toEqual([200, 409]);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bk.id } });
    expect(row.depositOutcome).toBe(payRes.statusCode === 200 ? 'USED' : 'REFUNDED');
    expect((payRes.statusCode === 200 ? refundRes : payRes).json().error.code).toBe('DEPOSIT_NOT_AVAILABLE');
  });
});
