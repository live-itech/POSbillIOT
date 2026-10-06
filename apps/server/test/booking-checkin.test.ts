import type { BoardSnapshot } from '@funplay/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id);
  t = await makeApp(); // 10:00 WIB
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
/** Meja 2, 10:30–11:30 WIB; hold mulai 10:15. */
const book = (over: Record<string, unknown> = {}) =>
  req('POST', '/api/bookings', { unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', ...over });
const checkIn = (id: string, body: Record<string, unknown> = { mode: 'OPEN' }) => req('POST', `/api/bookings/${id}/check-in`, body);
const unitM2 = async () => ((await req('GET', '/api/board')).json() as BoardSnapshot).units.find((u) => u.id === b.m2.id)!;

describe('hold', () => {
  it('meja tampil Booked mulai hold', async () => {
    const bk = (await book()).json().booking;
    expect((await unitM2()).booking).toBeNull();
    t.clock.advanceMinutes(15);
    expect((await unitM2()).booking).toEqual({ id: bk.id, customerName: 'Budi', startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, depositPaid: false });
  });

  it('mulai sesi di meja yang di-hold → BOOKING_HOLD; ignoreBooking melanjutkan dan diaudit', async () => {
    const bk = (await book()).json().booking;
    t.clock.advanceMinutes(15);
    const res = await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toEqual({
      code: 'BOOKING_HOLD',
      message: 'Meja 2 dibooking Budi jam 10:30',
      details: { booking: { id: bk.id, customerName: 'Budi', startAt: '2026-10-01T03:30:00.000Z' } },
    });
    const ok = await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN', ignoreBooking: true });
    expect(ok.statusCode).toBe(200);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'session.start_ignore_booking' } });
    expect(log).toMatchObject({ entityId: bk.id, userId: users.kasir.id });
  });

  it('paket yang menabrak booking ditolak sebelum hold; open billing boleh', async () => {
    await book();
    expect((await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().error.code).toBe('BOOKING_HOLD'); // 10:00–11:00
    expect((await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN' })).statusCode).toBe(200);
  });
});

describe('check-in', () => {
  it('terlalu awal ditolak; sesi + bill booking + member; hold sendiri tidak dihitung; hanya sekali', async () => {
    const gold = await prisma.memberLevel.create({ data: { name: 'Gold', timeDiscountPct: 10 } });
    const sinta = await prisma.member.create({ data: { code: 'M0001', name: 'Sinta', levelId: gold.id } });
    const bk = (await book({ memberId: sinta.id })).json().booking;
    expect((await checkIn(bk.id)).json().error).toMatchObject({ code: 'BOOKING_TOO_EARLY', message: 'Check-in baru bisa mulai 10:15' });
    t.clock.advanceMinutes(15);
    const res = await checkIn(bk.id);
    expect(res.statusCode).toBe(200);
    const session = res.json().unit.session;
    expect(session).toMatchObject({ mode: 'OPEN', status: 'RUNNING' });
    expect(res.json().unit.booking).toBeNull();
    expect(res.json().booking).toMatchObject({ status: 'CHECKED_IN', saleBillId: session.billId });
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: session.billId } })).bookingId).toBe(bk.id);
    expect((await req('GET', `/api/bills/${session.billId}`)).json().member).toMatchObject({ name: 'Sinta', levelName: 'Gold', timeDiscountPct: 10 });
    expect((await checkIn(bk.id)).json().error.code).toBe('BOOKING_NOT_ACTIVE');
    expect(await prisma.auditLog.count({ where: { action: 'booking.check_in' } })).toBe(1);
  });

  it('check-in saat meja dipakai → UNIT_BUSY; check-in paralel → satu berhasil', async () => {
    const bk = (await book()).json().booking;
    t.clock.advanceMinutes(15);
    const walkIn = (await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN', ignoreBooking: true })).json().unit.session;
    expect((await checkIn(bk.id)).json().error.code).toBe('UNIT_BUSY');
    await req('POST', `/api/sessions/${walkIn.id}/stop`, {});
    const [x, y] = await Promise.all([checkIn(bk.id), checkIn(bk.id)]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.session.count({ where: { status: { not: 'ENDED' } } })).toBe(1);
  });

  it('check-in membatalkan bill DP yang belum dibayar; tanpa shift ditolak tanpa efek', async () => {
    const created = (await book({ depositAmount: 20000 })).json();
    t.clock.advanceMinutes(15);
    await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect((await checkIn(created.booking.id)).json().error.code).toBe('NO_OPEN_SHIFT');
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: created.depositBillId } })).status).toBe('OPEN');
    await req('POST', '/api/shifts', { openingCash: 0 });
    expect((await checkIn(created.booking.id)).statusCode).toBe(200);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: created.depositBillId } })).status).toBe('CANCELLED');
  });
});
