import type { BillLine } from '@prisma/client';
import type { BillStatus, BillSummary, BillView, Discount, PublicUser } from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { lockBooking } from '../bookings/booking-lock';
import { memberSnapshot, requireActiveMember } from '../members/members.service';
import { nextBillNumber } from '../sessions/sessions.service';
import { getSettings } from '../settings/settings.service';
import { requireOpenShift } from '../shifts/shifts.service';
import { linesTotals, loadBillView, lockBill, toBillSummary } from './bill-view';

export type AddItem = { productId: string; qty: number } | { custom: { name: string; price: number }; qty: number };
export interface BillFilter { status?: BillStatus; from?: Date; to?: Date; q?: string }

async function requireOpenBill(tx: Db, billId: string) {
  await lockBill(tx, billId);
  const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { lines: true } });
  if (bill.status !== 'OPEN') throw conflict('BILL_NOT_OPEN', 'Bill sudah tidak bisa diubah');
  return bill;
}

/** Bill OPEN yang isinya boleh diubah: bill DP booking (kind DEPOSIT) hanya satu baris dan dikunci. */
async function requireOpenSaleBill(tx: Db, billId: string) {
  const bill = await requireOpenBill(tx, billId);
  if (bill.kind === 'DEPOSIT') throw conflict('DEPOSIT_BILL_LOCKED', 'Bill DP booking tidak bisa diubah');
  return bill;
}

function findLine(lines: BillLine[], lineId: string): BillLine {
  const line = lines.find((l) => l.id === lineId);
  if (!line) throw notFound('Item');
  return line;
}

export class BillService {
  constructor(private readonly ctx: AppContext) {}

  private changed(...billIds: string[]): void {
    for (const id of billIds) this.ctx.bus.emit('bill.changed', id);
  }

  async createStandalone(user: PublicUser): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const settings = await getSettings(prisma);
    const bill = await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      const b = await tx.bill.create({ data: { number: await nextBillNumber(tx, clock.now(), settings.utcOffsetMin), label: 'Tagihan lepas', createdById: user.id } });
      await audit(tx, { userId: user.id, action: 'bill.create', entity: 'Bill', entityId: b.id });
      return b;
    });
    this.changed(bill.id);
    return loadBillView(prisma, bill.id);
  }

  async addItems(user: PublicUser, billId: string, items: AddItem[]): Promise<BillView> {
    const { prisma } = this.ctx;
    await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      const bill = await requireOpenSaleBill(tx, billId);
      const lines = [...bill.lines];
      for (const item of items) {
        if ('custom' in item) {
          const l = await tx.billLine.create({
            data: { billId, type: 'CUSTOM', nameSnapshot: item.custom.name, unitPrice: item.custom.price, qty: item.qty, createdById: user.id },
          });
          await audit(tx, { userId: user.id, action: 'bill.custom_item', entity: 'Bill', entityId: billId, data: { lineId: l.id, name: item.custom.name, price: item.custom.price, qty: item.qty } });
          lines.push(l);
          continue;
        }
        const p = await tx.product.findUnique({ where: { id: item.productId } });
        if (!p) throw notFound('Produk');
        if (!p.active) throw badRequest('PRODUCT_INACTIVE', `${p.name} sedang tidak dijual`);
        const same = lines.find((l) => l.productId === p.id && l.unitPrice === p.price && !l.discountType);
        if (same) {
          const updated = await tx.billLine.update({ where: { id: same.id }, data: { qty: same.qty + item.qty } });
          lines[lines.indexOf(same)] = updated;
        } else {
          lines.push(
            await tx.billLine.create({
              data: { billId, type: p.kind === 'STOCK' ? 'PRODUCT' : 'SERVICE', productId: p.id, nameSnapshot: p.name, unitPrice: p.price, qty: item.qty, createdById: user.id },
            }),
          );
        }
      }
      await audit(tx, { userId: user.id, action: 'bill.add_items', entity: 'Bill', entityId: billId, data: { count: items.length } });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async updateLine(user: PublicUser, billId: string, lineId: string, input: { qty?: number; discount?: Discount | null; approvalPin?: string }): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const current = await prisma.billLine.findFirst({ where: { id: lineId, billId } });
    if (!current) throw notFound('Item');
    if (input.qty !== undefined && current.type === 'TIME' && input.qty !== current.qty) throw conflict('LINE_LOCKED', 'Jumlah baris waktu tidak bisa diubah');
    const decreasing = input.qty !== undefined && input.qty < current.qty;
    const approvedById = decreasing ? await approveWithPin(prisma, clock, user, input.approvalPin) : null;

    await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      const bill = await requireOpenSaleBill(tx, billId);
      const line = findLine(bill.lines, lineId);
      if (input.qty !== undefined && input.qty < line.qty && !approvedById) throw conflict('TOTAL_CHANGED', 'Item berubah, muat ulang bill');
      await tx.billLine.update({
        where: { id: line.id },
        data: {
          ...(input.qty !== undefined ? { qty: input.qty } : {}),
          ...(input.discount !== undefined ? { discountType: input.discount?.type ?? null, discountValue: input.discount?.value ?? 0 } : {}),
        },
      });
      await audit(tx, { userId: user.id, action: 'bill.update_item', entity: 'Bill', entityId: billId, data: { lineId, from: line.qty, qty: input.qty ?? null, discount: input.discount === undefined ? null : input.discount ? { ...input.discount } : null }, approvedById });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async deleteLine(user: PublicUser, billId: string, lineId: string, approvalPin?: string): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const current = await prisma.billLine.findFirst({ where: { id: lineId, billId } });
    if (!current) throw notFound('Item');
    if (current.type === 'TIME') throw conflict('LINE_LOCKED', 'Baris waktu tidak bisa dihapus');
    const approvedById = await approveWithPin(prisma, clock, user, approvalPin);
    await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      const bill = await requireOpenSaleBill(tx, billId);
      const line = findLine(bill.lines, lineId);
      await tx.billLine.delete({ where: { id: line.id } });
      await audit(tx, { userId: user.id, action: 'bill.remove_item', entity: 'Bill', entityId: billId, data: { name: line.nameSnapshot, qty: line.qty, unitPrice: line.unitPrice }, approvedById });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async setBillDiscount(user: PublicUser, billId: string, discount: Discount | null): Promise<BillView> {
    const { prisma } = this.ctx;
    await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      await requireOpenSaleBill(tx, billId);
      await tx.bill.update({ where: { id: billId }, data: { billDiscountType: discount?.type ?? null, billDiscountValue: discount?.value ?? 0 } });
      await audit(tx, { userId: user.id, action: 'bill.discount', entity: 'Bill', entityId: billId, data: { discount: discount ? { ...discount } : null } });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  /** Pasang (memberId) atau lepas (null) member. Persen diskon level di-snapshot ulang setiap kali dipasang. */
  async setMember(user: PublicUser, billId: string, memberId: string | null): Promise<BillView> {
    const { prisma } = this.ctx;
    await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      await requireOpenSaleBill(tx, billId);
      const m = memberId ? await requireActiveMember(tx, memberId) : null;
      const snap = memberSnapshot(m);
      await tx.bill.update({ where: { id: billId }, data: snap });
      await audit(tx, {
        userId: user.id, action: 'bill.member', entity: 'Bill', entityId: billId,
        data: { memberId: snap.memberId, timePct: snap.memberTimeDiscountPct, fnbPct: snap.memberFnbDiscountPct },
      });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async cancel(user: PublicUser, billId: string, input: { reason: string; approvalPin?: string }): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const settings = await getSettings(prisma);
    const pre = await prisma.bill.findUnique({ where: { id: billId }, include: { lines: true, sessions: { where: { status: { not: 'ENDED' } } } } });
    if (!pre) throw notFound('Bill');
    if (pre.kind === 'DEPOSIT') throw conflict('DEPOSIT_BILL_LOCKED', 'Bill DP booking dibatalkan lewat menu Booking');
    if (pre.sessions.length) throw conflict('SESSION_ACTIVE', 'Hentikan sesi meja terlebih dahulu');
    // keputusan PIN memakai subtotal sebelum diskon (diskon 100% tidak boleh menghindari PIN)
    const approvedById = linesTotals(pre, settings).subtotal > 0 ? await approveWithPin(prisma, clock, user, input.approvalPin) : null;
    await prisma.$transaction(async (tx) => {
      const locked = await requireOpenSaleBill(tx, billId);
      const running = await tx.session.count({ where: { billId, status: { not: 'ENDED' } } });
      if (running) throw conflict('SESSION_ACTIVE', 'Hentikan sesi meja terlebih dahulu');
      const lockedTotals = linesTotals(locked, settings);
      if (lockedTotals.subtotal > 0 && !approvedById && user.role === 'KASIR') {
        throw new AppError(403, 'APPROVAL_REQUIRED', 'Aksi ini butuh PIN supervisor');
      }
      await tx.bill.update({ where: { id: billId }, data: { status: 'CANCELLED', cancelReason: input.reason } });
      await audit(tx, { userId: user.id, action: 'bill.cancel', entity: 'Bill', entityId: billId, data: { reason: input.reason, subtotal: lockedTotals.subtotal, grandTotal: lockedTotals.grandTotal }, approvedById });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async merge(user: PublicUser, targetId: string, sourceId: string): Promise<BillView> {
    const { prisma } = this.ctx;
    if (targetId === sourceId) throw badRequest('SAME_BILL', 'Pilih bill lain untuk digabung');
    const moved = await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      // urutan kunci global: sesi → bill → booking (sama dengan stop/checkout)
      await tx.$queryRaw`SELECT id FROM "Session" WHERE "billId" IN (${targetId}, ${sourceId}) AND status <> 'ENDED' ORDER BY id FOR UPDATE`;
      for (const id of [targetId, sourceId].sort()) await lockBill(tx, id); // urutan tetap → tidak deadlock
      const [target, source] = await Promise.all([
        tx.bill.findUniqueOrThrow({ where: { id: targetId } }),
        tx.bill.findUniqueOrThrow({ where: { id: sourceId }, include: { sessions: { where: { status: { not: 'ENDED' } } } } }),
      ]);
      if (target.status !== 'OPEN' || source.status !== 'OPEN') throw conflict('BILL_NOT_OPEN', 'Hanya bill yang belum dibayar yang bisa digabung');
      if (target.kind === 'DEPOSIT' || source.kind === 'DEPOSIT') throw conflict('DEPOSIT_BILL_LOCKED', 'Bill DP booking tidak bisa digabung');
      if (target.bookingId && source.bookingId) throw conflict('MERGE_CONFLICT', 'Kedua bill terhubung ke booking yang berbeda');
      if (target.memberId && source.memberId && target.memberId !== source.memberId) {
        throw conflict('MERGE_CONFLICT', 'Kedua bill memakai member yang berbeda');
      }
      if (source.bookingId) {
        await lockBooking(tx, source.bookingId);
        await tx.booking.update({ where: { id: source.bookingId }, data: { saleBillId: targetId } });
      }
      await tx.billLine.updateMany({ where: { billId: sourceId }, data: { billId: targetId } });
      await tx.session.updateMany({ where: { billId: sourceId }, data: { billId: targetId } });
      await tx.bill.update({
        where: { id: sourceId },
        data: { status: 'CANCELLED', mergedIntoId: targetId, cancelReason: `Digabung ke ${target.number}`, bookingId: null },
      });
      await tx.bill.update({
        where: { id: targetId },
        data: {
          label: `${target.label} + ${source.label}`,
          ...(source.bookingId ? { bookingId: source.bookingId } : {}),
          ...(!target.memberId && source.memberId
            ? {
                memberId: source.memberId,
                memberName: source.memberName,
                memberLevelName: source.memberLevelName,
                memberTimeDiscountPct: source.memberTimeDiscountPct,
                memberFnbDiscountPct: source.memberFnbDiscountPct,
              }
            : {}),
        },
      });
      await audit(tx, {
        userId: user.id, action: 'bill.merge', entity: 'Bill', entityId: targetId,
        data: { sourceBillId: sourceId, bookingId: source.bookingId, memberId: source.memberId },
      });
      return { units: source.sessions.map((s) => s.unitId), bookingId: source.bookingId };
    });
    for (const unitId of moved.units) this.ctx.bus.emit('unit.changed', unitId); // SessionView.billId berubah
    if (moved.bookingId) this.ctx.bus.emit('booking.changed', moved.bookingId);
    this.changed(targetId, sourceId);
    return loadBillView(prisma, targetId);
  }

  async list(filter: BillFilter): Promise<BillSummary[]> {
    const { prisma } = this.ctx;
    const settings = await getSettings(prisma);
    const rows = await prisma.bill.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
        ...(filter.q ? { OR: [{ number: { contains: filter.q, mode: 'insensitive' } }, { label: { contains: filter.q, mode: 'insensitive' } }] } : {}),
      },
      include: { lines: true, sessions: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => toBillSummary(r, settings));
  }
}
