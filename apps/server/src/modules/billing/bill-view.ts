import type { Prisma, BillLine } from '@prisma/client';
import {
  computeBillTotals, DISCOUNT_TYPES, lineScope,
  type BillBookingView, type BillKind, type BillSummary, type BillTotals, type BillView, type ChargeLine, type Discount, type MemberDiscount, type PublicSettings,
  type TotalsLineInput,
} from '@funplay/shared';
import { z } from 'zod';
import type { Db } from '../../db';
import { notFound } from '../../lib/errors';
import { toSessionView } from '../board/board';
import { sessionParts } from '../sessions/sessions.service';
import { userNames } from '../shifts/shifts.service';

export const discountSchema = z
  .object({ type: z.enum(DISCOUNT_TYPES), value: z.number().int().min(0) })
  .refine((d) => d.type !== 'PERCENT' || d.value <= 100, { message: 'Diskon persen maksimal 100' });

export const billInclude = {
  lines: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  sessions: { where: { status: { not: 'ENDED' } }, include: { ...sessionParts, unit: { select: { name: true } } } },
  member: { select: { code: true } },
} satisfies Prisma.BillInclude;
export type BillRow = Prisma.BillGetPayload<{ include: typeof billInclude }>;

/** Kolom bill yang dibutuhkan kalkulator total (baris tersimpan + diskon bill + snapshot member). */
export interface TotalsBill {
  lines: BillLine[];
  billDiscountType: Discount['type'] | null;
  billDiscountValue: number;
  memberId: string | null;
  memberTimeDiscountPct: number;
  memberFnbDiscountPct: number;
}

export const lineDiscount = (l: Pick<BillLine, 'discountType' | 'discountValue'>): Discount | null =>
  l.discountType ? { type: l.discountType, value: l.discountValue } : null;

export const billDiscountOf = (b: { billDiscountType: Discount['type'] | null; billDiscountValue: number }): Discount | null =>
  b.billDiscountType ? { type: b.billDiscountType, value: b.billDiscountValue } : null;

/** Snapshot diskon level di bill; null bila bill tanpa member. */
export const memberDiscountOf = (b: Pick<TotalsBill, 'memberId' | 'memberTimeDiscountPct' | 'memberFnbDiscountPct'>): MemberDiscount | null =>
  b.memberId ? { timePct: b.memberTimeDiscountPct, fnbPct: b.memberFnbDiscountPct } : null;

export const totalsInput = (lines: BillLine[]): TotalsLineInput[] =>
  lines.map((l) => ({ id: l.id, scope: lineScope(l.type), amount: l.unitPrice * l.qty, discount: lineDiscount(l) }));

/** Total dari baris tersimpan (sesi yang masih berjalan tidak ikut), termasuk diskon member. */
export function linesTotals(bill: TotalsBill, settings: PublicSettings, discount: Discount | null = billDiscountOf(bill)): BillTotals {
  return computeBillTotals(totalsInput(bill.lines), discount, settings, memberDiscountOf(bill));
}

export async function lockBill(tx: Db, billId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Bill" WHERE id = ${billId} FOR UPDATE`;
  if (!rows.length) throw notFound('Bill');
}

/** Booking milik bill: bill DEPOSIT lewat `Booking.depositBillId`, bill SALE lewat `Bill.bookingId`. */
export async function bookingOfBill(db: Db, bill: { id: string; kind: BillKind; bookingId: string | null }) {
  if (bill.kind === 'DEPOSIT') return db.booking.findUnique({ where: { depositBillId: bill.id } });
  return bill.bookingId ? db.booking.findUnique({ where: { id: bill.bookingId } }) : null;
}

/** `deposit.available` = bill DEPOSIT PAID dan DP belum dipakai, hangus, atau dikembalikan. */
async function billBooking(db: Db, b: { id: string; kind: BillKind; bookingId: string | null }): Promise<BillBookingView | null> {
  const bk = await bookingOfBill(db, b);
  if (!bk) return null;
  let deposit: BillBookingView['deposit'] = null;
  if (b.kind === 'SALE' && bk.depositAmount > 0) {
    const dep = bk.depositBillId ? await db.bill.findUnique({ where: { id: bk.depositBillId }, select: { status: true } }) : null;
    deposit = { amount: bk.depositAmount, available: dep?.status === 'PAID' && bk.depositOutcome === null };
  }
  return { id: bk.id, customerName: bk.customerName, startAt: bk.startAt.toISOString(), status: bk.status, deposit };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function toBillView(db: Db, b: BillRow): Promise<BillView> {
  const names = await userNames(db, [b.createdById, b.paidById]);
  return {
    id: b.id,
    number: b.number,
    label: b.label,
    status: b.status,
    kind: b.kind,
    member: b.memberId
      ? {
          id: b.memberId,
          code: b.member?.code ?? '',
          name: b.memberName ?? '',
          levelName: b.memberLevelName ?? '',
          timeDiscountPct: b.memberTimeDiscountPct,
          fnbDiscountPct: b.memberFnbDiscountPct,
        }
      : null,
    booking: await billBooking(db, b),
    createdAt: b.createdAt.toISOString(),
    createdByName: names.get(b.createdById) ?? '-',
    billDiscount: billDiscountOf(b),
    lines: b.lines.map((l) => ({
      id: l.id,
      type: l.type,
      productId: l.productId,
      sessionId: l.sessionId,
      name: l.nameSnapshot,
      unitPrice: l.unitPrice,
      qty: l.qty,
      discount: lineDiscount(l),
      breakdown: (l.breakdown as ChargeLine[] | null) ?? null,
    })),
    activeSessions: b.sessions.map((s) => ({ ...toSessionView(s), unitName: s.unit.name })),
    payments: b.payments.map((p) => ({
      id: p.id, method: p.method, amount: p.amount, received: p.received, change: p.change, reference: p.reference, createdAt: p.createdAt.toISOString(),
    })),
    stored:
      b.status === 'PAID' || b.status === 'VOID'
        ? { subtotal: b.subtotal, discountTotal: b.discountTotal, serviceTotal: b.serviceTotal, taxTotal: b.taxTotal, grandTotal: b.grandTotal }
        : null,
    paidAt: iso(b.paidAt),
    paidByName: b.paidById ? (names.get(b.paidById) ?? '-') : null,
    shiftId: b.shiftId,
    mergedIntoId: b.mergedIntoId,
    cancelReason: b.cancelReason,
    voidReason: b.voidReason,
    voidedAt: iso(b.voidedAt),
  };
}

export async function loadBillView(db: Db, billId: string): Promise<BillView> {
  const b = await db.bill.findUnique({ where: { id: billId }, include: billInclude });
  if (!b) throw notFound('Bill');
  return toBillView(db, b);
}

export function toBillSummary(
  b: TotalsBill & {
    id: string; number: string; label: string; status: BillSummary['status']; kind: BillKind; createdAt: Date; paidAt: Date | null; grandTotal: number;
    sessions: { status: string }[];
  },
  settings: PublicSettings,
): BillSummary {
  const stored = b.status === 'PAID' || b.status === 'VOID';
  return {
    id: b.id,
    number: b.number,
    label: b.label,
    status: b.status,
    kind: b.kind,
    createdAt: b.createdAt.toISOString(),
    paidAt: iso(b.paidAt),
    total: stored ? b.grandTotal : linesTotals(b, settings).grandTotal,
    hasActiveSession: b.sessions.some((s) => s.status !== 'ENDED'),
  };
}
