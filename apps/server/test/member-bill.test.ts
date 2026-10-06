import type { MemberLevel, Member } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers, T0 } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;
let teh: { id: string };
let gold: MemberLevel;
let sinta: Member;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id);
  const cat = await prisma.category.create({ data: { name: 'Minuman' } });
  teh = await prisma.product.create({ data: { name: 'Es Teh', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 10 } });
  gold = await prisma.memberLevel.create({ data: { name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 } });
  sinta = await prisma.member.create({ data: { code: 'M0001', name: 'Sinta', phone: '0811', levelId: gold.id } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const pay = (billId: string, total: number, key = 'key-0000001') =>
  req('POST', `/api/bills/${billId}/checkout`, { idempotencyKey: key, expectedGrandTotal: total, payments: [{ method: 'CASH', amount: total }] });

/** Meja 1 open billing 60 menit (Rp40.000) + 2 Es Teh (Rp16.000). */
async function sessionBill(memberId?: string): Promise<string> {
  const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN', ...(memberId ? { memberId } : {}) })).json().unit.session;
  await req('POST', `/api/bills/${s.billId}/items`, { items: [{ productId: teh.id, qty: 2 }] });
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${s.id}/stop`, {});
  return s.billId;
}

async function standalone(memberId?: string): Promise<string> {
  const bill = (await req('POST', '/api/bills')).json();
  await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] });
  if (memberId) await req('PUT', `/api/bills/${bill.id}/member`, { memberId });
  return bill.id;
}

describe('member di bill', () => {
  it('mulai sesi dengan member: snapshot diskon level di bill', async () => {
    const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN', memberId: sinta.id })).json().unit.session;
    const bill = (await req('GET', `/api/bills/${s.billId}`)).json();
    expect(bill.kind).toBe('SALE');
    expect(bill.member).toEqual({ id: sinta.id, code: 'M0001', name: 'Sinta', levelName: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 });
    expect((await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN', memberId: 'tidak-ada' })).statusCode).toBe(404);
  });

  it('diskon member masuk total server dan tidak butuh PIN walau besar', async () => {
    const billId = await sessionBill(sinta.id);
    // waktu 40.000 − 10% = 36.000; teh 16.000 − 5% = 15.200 → 51.200
    const res = await pay(billId, 51200);
    expect(res.statusCode).toBe(200);
    expect(res.json().bill.stored).toEqual({ subtotal: 56000, discountTotal: 4800, serviceTotal: 0, taxTotal: 0, grandTotal: 51200 });

    const platinum = await prisma.memberLevel.create({ data: { name: 'Platinum', timeDiscountPct: 50, fnbDiscountPct: 50 } });
    const budi = await prisma.member.create({ data: { code: 'M0002', name: 'Budi', levelId: platinum.id } });
    t.clock.set(T0);
    const other = await sessionBill(budi.id);
    // 56.000 − 50% = 28.000; kasir tanpa PIN karena diskon level tidak dihitung untuk batas persetujuan
    expect((await pay(other, 28000, 'key-0000002')).statusCode).toBe(200);
  });

  it('pasang/lepas member di bill OPEN; snapshot dihitung ulang saat dipasang ulang', async () => {
    const billId = await standalone();
    const on = await req('PUT', `/api/bills/${billId}/member`, { memberId: sinta.id });
    expect(on.statusCode).toBe(200);
    expect(on.json().member).toMatchObject({ name: 'Sinta', fnbDiscountPct: 5 });
    await prisma.memberLevel.update({ where: { id: gold.id }, data: { fnbDiscountPct: 20 } });
    expect((await req('GET', `/api/bills/${billId}`)).json().member.fnbDiscountPct).toBe(5);
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: sinta.id })).json().member.fnbDiscountPct).toBe(20);
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: null })).json().member).toBeNull();
    await prisma.member.update({ where: { id: sinta.id }, data: { active: false } });
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: sinta.id })).json().error.code).toBe('MEMBER_INACTIVE');
    expect(await prisma.auditLog.count({ where: { action: 'bill.member' } })).toBe(3);
  });

  it('bill PAID tidak berubah saat level diedit', async () => {
    const billId = await standalone(sinta.id);
    expect((await pay(billId, 7600)).statusCode).toBe(200); // 8.000 − 5%
    await prisma.memberLevel.update({ where: { id: gold.id }, data: { fnbDiscountPct: 50 } });
    const view = (await req('GET', `/api/bills/${billId}`)).json();
    expect(view.stored.grandTotal).toBe(7600);
    expect(view.member.fnbDiscountPct).toBe(5);
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: null })).json().error.code).toBe('BILL_NOT_OPEN');
  });

  it('pasang member butuh shift', async () => {
    const billId = await standalone();
    await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect((await req('PUT', `/api/bills/${billId}/member`, { memberId: sinta.id })).json().error.code).toBe('NO_OPEN_SHIFT');
  });

  it('gabung: member sumber pindah ke target; member berbeda → MERGE_CONFLICT', async () => {
    const a = await standalone();
    const s = await standalone(sinta.id);
    const merged = await req('POST', `/api/bills/${a}/merge`, { sourceBillId: s });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().member).toMatchObject({ name: 'Sinta', levelName: 'Gold' });
    const budi = await prisma.member.create({ data: { code: 'M0002', name: 'Budi', levelId: gold.id } });
    const c = await standalone(budi.id);
    const d = await standalone(sinta.id);
    expect((await req('POST', `/api/bills/${c}/merge`, { sourceBillId: d })).json().error.code).toBe('MERGE_CONFLICT');
  });
});

describe('bill DEPOSIT', () => {
  it('tidak bisa diubah, digabung, atau dibatalkan manual; total tanpa pajak/service', async () => {
    const dep = await prisma.bill.create({
      data: {
        number: 'FP-DP-0001', label: 'DP · Budi', kind: 'DEPOSIT', createdById: users.kasir.id,
        lines: { create: { type: 'DEPOSIT', nameSnapshot: 'DP booking', unitPrice: 50000, qty: 1, createdById: users.kasir.id } },
      },
    });
    const code = async (r: ReturnType<typeof req>) => (await r).json().error.code;
    expect(await code(req('POST', `/api/bills/${dep.id}/items`, { items: [{ productId: teh.id, qty: 1 }] }))).toBe('DEPOSIT_BILL_LOCKED');
    expect(await code(req('PUT', `/api/bills/${dep.id}/discount`, { discount: { type: 'PERCENT', value: 10 } }))).toBe('DEPOSIT_BILL_LOCKED');
    expect(await code(req('PUT', `/api/bills/${dep.id}/member`, { memberId: sinta.id }))).toBe('DEPOSIT_BILL_LOCKED');
    expect(await code(req('POST', `/api/bills/${dep.id}/cancel`, { reason: 'x', approvalPin: '1111' }))).toBe('DEPOSIT_BILL_LOCKED');
    const other = await standalone();
    expect(await code(req('POST', `/api/bills/${other}/merge`, { sourceBillId: dep.id }))).toBe('DEPOSIT_BILL_LOCKED');
    await prisma.setting.update({ where: { id: 1 }, data: { taxPct: 10, servicePct: 5 } });
    const res = await pay(dep.id, 50000);
    expect(res.statusCode).toBe(200);
    expect(res.json().bill.stored).toEqual({ subtotal: 50000, discountTotal: 0, serviceTotal: 0, taxTotal: 0, grandTotal: 50000 });
  });
});
