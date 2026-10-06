import type { Prisma } from '@prisma/client';
import type { BookingView } from '@funplay/shared';
import type { Db } from '../../db';
import { notFound } from '../../lib/errors';
import { userNames } from '../shifts/shifts.service';

export const bookingInclude = { unit: { select: { name: true } }, member: { select: { code: true } } } satisfies Prisma.BookingInclude;
export type BookingRow = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

export async function toBookingViews(db: Db, rows: BookingRow[]): Promise<BookingView[]> {
  const depIds = rows.map((r) => r.depositBillId).filter((x): x is string => !!x);
  const deps = depIds.length ? await db.bill.findMany({ where: { id: { in: depIds } }, select: { id: true, status: true } }) : [];
  const depStatus = new Map(deps.map((d) => [d.id, d.status]));
  const names = await userNames(db, rows.map((r) => r.createdById));
  return rows.map((r) => ({
    id: r.id,
    unitId: r.unitId,
    unitName: r.unit.name,
    customerName: r.customerName,
    phone: r.phone,
    memberId: r.memberId,
    memberCode: r.member?.code ?? null,
    startAt: r.startAt.toISOString(),
    durationMin: r.durationMin,
    note: r.note,
    status: r.status,
    depositAmount: r.depositAmount,
    depositBillId: r.depositBillId,
    depositBillStatus: r.depositBillId ? (depStatus.get(r.depositBillId) ?? null) : null,
    depositOutcome: r.depositOutcome,
    depositUsedAmount: r.depositUsedAmount,
    saleBillId: r.saleBillId,
    cancelReason: r.cancelReason,
    createdByName: names.get(r.createdById) ?? '-',
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function loadBookingView(db: Db, id: string): Promise<BookingView> {
  const row = await db.booking.findUnique({ where: { id }, include: bookingInclude });
  if (!row) throw notFound('Booking');
  return (await toBookingViews(db, [row]))[0]!;
}
