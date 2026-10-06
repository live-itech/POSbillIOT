import {
  formatReceiptDate, localHHMM, PAYMENT_METHOD_LABEL, PAYMENT_METHODS,
  type ChargeLine, type PublicSettings, type ReceiptModel, type ShiftReportModel,
} from '@funplay/shared';
import type { Db } from '../../db';
import { notFound } from '../../lib/errors';
import { shiftSummary, userNames } from '../shifts/shifts.service';
import { linesTotals } from '../billing/bill-view';

const minutesLabel = (m: number) => (m % 60 === 0 ? `${m / 60} jam` : m > 60 ? `${Math.floor(m / 60)} jam ${m % 60} mnt` : `${m} mnt`);

export async function buildReceiptModel(db: Db, billId: string, settings: PublicSettings, now: Date, reprint: boolean): Promise<ReceiptModel> {
  const b = await db.bill.findUnique({
    where: { id: billId },
    include: { lines: { orderBy: { createdAt: 'asc' } }, payments: { orderBy: { createdAt: 'asc' } }, sessions: { include: { unit: { select: { name: true } } }, orderBy: { startedAt: 'asc' } } },
  });
  if (!b) throw notFound('Bill');
  const names = await userNames(db, [b.paidById, b.createdById]);
  const totals = linesTotals(b, settings);
  const off = settings.utcOffsetMin;
  return {
    outletName: settings.outletName,
    address: settings.address,
    header: settings.receiptHeader,
    footer: settings.receiptFooter,
    billNumber: b.number,
    printedAt: formatReceiptDate(b.paidAt ?? now, off),
    cashier: names.get(b.paidById ?? b.createdById) ?? '-',
    label: b.label,
    sessions: b.sessions
      .filter((s) => s.endedAt)
      .map((s) => ({ unitName: s.unit.name, start: localHHMM(s.startedAt, off), end: localHHMM(s.endedAt!, off) })),
    lines: b.lines.map((l, i) => ({
      name: l.nameSnapshot,
      qty: l.qty,
      unitPrice: l.unitPrice,
      amount: l.unitPrice * l.qty,
      discount: totals.lines[i]!.itemDiscount,
      details: ((l.breakdown as ChargeLine[] | null) ?? []).map((c) => `${c.label} ${minutesLabel(c.minutes)}`),
    })),
    subtotal: b.subtotal,
    discountTotal: b.discountTotal,
    serviceTotal: b.serviceTotal,
    taxTotal: b.taxTotal,
    grandTotal: b.grandTotal,
    payments: b.payments.map((p) => ({ label: p.reference ? `${PAYMENT_METHOD_LABEL[p.method]} ${p.reference}` : PAYMENT_METHOD_LABEL[p.method], amount: p.received ?? p.amount })),
    change: b.payments.reduce((a, p) => a + (p.change ?? 0), 0),
    copy: b.status === 'VOID' ? 'VOID' : reprint ? 'REPRINT' : null,
  };
}

export async function buildShiftReportModel(db: Db, shiftId: string, settings: PublicSettings, now: Date): Promise<ShiftReportModel> {
  const s = await db.shift.findUnique({ where: { id: shiftId } });
  if (!s) throw notFound('Shift');
  const sum = await shiftSummary(db, s);
  const off = settings.utcOffsetMin;
  const rows = (rec: Record<string, number>) => PAYMENT_METHODS.filter((m) => rec[m]).map((m) => ({ label: PAYMENT_METHOD_LABEL[m], amount: rec[m]! }));
  return {
    outletName: settings.outletName,
    openedAt: formatReceiptDate(s.openedAt, off),
    closedAt: formatReceiptDate(s.closedAt ?? now, off),
    openedBy: sum.shift.openedByName,
    closedBy: sum.shift.closedByName ?? '-',
    openingCash: s.openingCash,
    sales: rows(sum.sales),
    voids: rows(sum.voids),
    billCount: sum.billCount,
    voidCount: sum.voidCount,
    expectedCash: s.expectedCash ?? sum.expectedCash,
    countedCash: s.countedCash ?? 0,
    note: s.note,
  };
}
