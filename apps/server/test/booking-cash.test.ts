import { twoCols } from '@funplay/shared';
import type { Member } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;
let sinta: Member;

beforeEach(async () => {
  await resetDb();
  const users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id, 100000);
  const gold = await prisma.memberLevel.create({ data: { name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 0 } });
  sinta = await prisma.member.create({ data: { code: 'M0001', name: 'Sinta', levelId: gold.id } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const pay = (billId: string, total: number, payments: unknown[], key = 'key-0000001') =>
  req('POST', `/api/bills/${billId}/checkout`, { idempotencyKey: key, expectedGrandTotal: total, payments });
const summary = async () => (await req('GET', '/api/shifts/current')).json().summary;
const receiptOf = (billId: string) => prisma.printJob.findFirst({ where: { billId, kind: 'RECEIPT' } });

/** Booking Meja 2 10:30 dengan DP tunai, check-in 10:15, main 60 menit (Rp40.000) lalu stop. */
async function checkedIn(deposit: number, memberId?: string) {
  const created = (await req('POST', '/api/bookings', {
    unitId: b.m2.id, startAt: '2026-10-01T03:30:00.000Z', durationMin: 60, customerName: 'Budi', depositAmount: deposit, ...(memberId ? { memberId } : {}),
  })).json();
  expect((await pay(created.depositBillId, deposit, [{ method: 'CASH', amount: deposit }], `dp-${created.booking.id}`)).statusCode).toBe(200);
  t.clock.advanceMinutes(15);
  const session = (await req('POST', `/api/bookings/${created.booking.id}/check-in`, { mode: 'OPEN' })).json().unit.session;
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${session.id}/stop`, {});
  return { saleBillId: session.billId as string, depositBillId: created.depositBillId as string };
}

describe('kas seharusnya dengan DP', () => {
  it('DP tunai lalu dipakai dengan kembalian; void mengembalikan sisa DP', async () => {
    const x = await checkedIn(50000);
    expect((await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 40000, received: 50000 }])).statusCode).toBe(200);
    // 100.000 + 50.000 (DP tunai) − 10.000 (kembalian DP) = 140.000
    expect(await summary()).toMatchObject({ sales: { CASH: 50000, DEPOSIT: 40000 }, depositChange: 10000, expectedCash: 140000 });
    await req('POST', `/api/bills/${x.saleBillId}/void`, { reason: 'salah meja', approvalPin: '1111' });
    // − 40.000 DP yang dikembalikan tunai saat void → 100.000
    expect(await summary()).toMatchObject({ voids: { DEPOSIT: 40000, CASH: 0 }, depositChange: 10000, expectedCash: 100000 });
  });

  it('DP lebih kecil dari total: sisa dibayar tunai', async () => {
    const x = await checkedIn(30000);
    await pay(x.saleBillId, 40000, [{ method: 'DEPOSIT', amount: 30000, received: 30000 }, { method: 'CASH', amount: 10000 }]);
    expect(await summary()).toMatchObject({ sales: { CASH: 40000, DEPOSIT: 30000 }, depositChange: 0, expectedCash: 140000 });
  });
});

describe('struk & rekap dengan member dan DP', () => {
  it('tanda terima DP, struk member + DP, rekap shift non-kas', async () => {
    const x = await checkedIn(50000, sinta.id);
    await vi.waitFor(async () => expect(await receiptOf(x.depositBillId)).not.toBeNull());
    expect((await receiptOf(x.depositBillId))!.previewText).toContain('TANDA TERIMA DP');

    // waktu 40.000 − 10% member = 36.000; DP 50.000 → kembali DP 14.000
    expect((await pay(x.saleBillId, 36000, [{ method: 'DEPOSIT', amount: 36000, received: 50000 }])).statusCode).toBe(200);
    await vi.waitFor(async () => expect(await receiptOf(x.saleBillId)).not.toBeNull());
    const text = (await receiptOf(x.saleBillId))!.previewText;
    expect(text).toContain('Member: Sinta (Gold)');
    expect(text).toContain(twoCols('  Diskon member', '-4.000'));
    expect(text).toContain(twoCols('TOTAL', '36.000'));
    expect(text).toContain(twoCols('DP booking', '50.000'));
    expect(text).toContain(twoCols('Kembali DP', '14.000'));
    expect(text).not.toContain('Kembalian');

    await req('POST', '/api/shifts/current/close', { countedCash: 136000 });
    await vi.waitFor(async () => expect(await prisma.printJob.findFirst({ where: { kind: 'SHIFT_REPORT' } })).not.toBeNull());
    const report = (await prisma.printJob.findFirstOrThrow({ where: { kind: 'SHIFT_REPORT' } })).previewText;
    expect(report).toContain(twoCols('  DP booking (non-kas)', '36.000'));
    expect(report).toContain(twoCols('  Kembali DP', '-14.000'));
    expect(report).toContain(twoCols('Kas seharusnya', '136.000'));
  });
});
