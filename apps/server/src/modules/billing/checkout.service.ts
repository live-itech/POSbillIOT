import { Prisma } from '@prisma/client';
import { checkPayments, needsDiscountApproval, type BillView, type CheckoutResult, type PaymentInput, type PublicUser } from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { getSettings } from '../settings/settings.service';
import { requireOpenShift } from '../shifts/shifts.service';
import { linesTotals, loadBillView, lockBill } from './bill-view';

export interface CheckoutInput { idempotencyKey: string; expectedGrandTotal: number; payments: PaymentInput[]; approvalPin?: string }

/** Jumlah per produk stok di bill (baris produk sama bisa lebih dari satu bila harganya berbeda). */
function stockQtyByProduct(lines: { type: string; productId: string | null; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (l.type === 'PRODUCT' && l.productId) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
  return m;
}

export class CheckoutService {
  constructor(private readonly ctx: AppContext) {}

  /** Hasil checkout sebelumnya untuk key ini (null bila belum ada). */
  private async prior(db: Db, billId: string, key: string): Promise<{ billId: string; change: number } | null> {
    const b = await db.bill.findUnique({ where: { checkoutKey: key }, include: { payments: true } });
    if (!b) return null;
    if (b.id !== billId) throw conflict('REQUEST_ID_USED', 'ID pembayaran sudah dipakai untuk bill lain');
    return { billId: b.id, change: b.payments.reduce((a, p) => a + (p.change ?? 0), 0) };
  }

  async checkout(user: PublicUser, billId: string, input: CheckoutInput): Promise<CheckoutResult> {
    const { prisma, clock } = this.ctx;
    const finish = async (r: { billId: string; change: number }) => ({ bill: await loadBillView(prisma, r.billId), change: r.change });

    const done = await this.prior(prisma, billId, input.idempotencyKey);
    if (done) return finish(done);

    const settings = await getSettings(prisma);
    const pre = await prisma.bill.findUnique({ where: { id: billId }, include: { lines: true } });
    if (!pre) throw notFound('Bill');
    // PIN diverifikasi di luar transaksi (approveWithPin menulis ke tabel User).
    const approvedById = needsDiscountApproval(linesTotals(pre, settings), settings.discountApprovalPct)
      ? await approveWithPin(prisma, clock, user, input.approvalPin)
      : null;

    let result: { billId: string; change: number };
    try {
      result = await prisma.$transaction(async (tx) => {
        await lockBill(tx, billId);
        const again = await this.prior(tx, billId, input.idempotencyKey); // request kembar yang baru selesai
        if (again) return again;
        const bill = await tx.bill.findUniqueOrThrow({
          where: { id: billId },
          include: { lines: true, sessions: { where: { status: { not: 'ENDED' } }, select: { id: true } } },
        });
        if (bill.status !== 'OPEN') throw conflict('BILL_NOT_OPEN', 'Bill sudah dibayar atau dibatalkan');
        if (bill.sessions.length) throw conflict('SESSION_ACTIVE', 'Hentikan sesi meja terlebih dahulu');
        if (!bill.lines.length) throw badRequest('BILL_EMPTY', 'Bill masih kosong');
        const shift = await requireOpenShift(tx);

        const totals = linesTotals(bill, settings);
        if (totals.grandTotal !== input.expectedGrandTotal) throw conflict('TOTAL_CHANGED', 'Total tagihan berubah. Periksa kembali sebelum membayar.');
        if (needsDiscountApproval(totals, settings.discountApprovalPct) && !approvedById) {
          throw conflict('TOTAL_CHANGED', 'Diskon berubah. Periksa kembali sebelum membayar.');
        }
        const pay = checkPayments(totals.grandTotal, input.payments);
        if (!pay.ok) throw badRequest(pay.code, pay.message);

        const now = clock.now();
        for (const p of pay.payments) {
          await tx.payment.create({
            data: { billId, shiftId: shift.id, method: p.method, amount: p.amount, received: p.received, change: p.change, reference: p.reference, createdAt: now },
          });
        }
        for (const [productId, qty] of stockQtyByProduct(bill.lines)) {
          await tx.product.update({ where: { id: productId }, data: { stockQty: { decrement: qty } } });
          await tx.stockMovement.create({ data: { productId, qty: -qty, reason: 'SALE', billId, userId: user.id } });
        }
        await tx.bill.update({
          where: { id: billId },
          data: {
            status: 'PAID', paidAt: now, paidById: user.id, shiftId: shift.id, checkoutKey: input.idempotencyKey,
            subtotal: totals.subtotal, discountTotal: totals.discountTotal, serviceTotal: totals.serviceTotal, taxTotal: totals.taxTotal, grandTotal: totals.grandTotal,
          },
        });
        await audit(tx, {
          userId: user.id, action: 'bill.paid', entity: 'Bill', entityId: billId, approvedById,
          data: { grandTotal: totals.grandTotal, discountTotal: totals.discountTotal, change: pay.change, payments: pay.payments.map((p) => ({ method: p.method, amount: p.amount })) },
        });
        return { billId, change: pay.change };
      });
    } catch (err) {
      // Dua request kembar lolos bersamaan: yang kalah menabrak unik checkoutKey → kembalikan hasil pemenang.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target ?? '').includes('checkoutKey')) {
        const won = await this.prior(prisma, billId, input.idempotencyKey);
        if (won) return finish(won);
      }
      throw err;
    }

    this.ctx.bus.emit('bill.changed', billId);
    this.ctx.bus.emit('shift.changed');
    // (Task 9) cetak struk setelah commit
    return finish(result);
  }

  async void(user: PublicUser, billId: string, input: { reason: string; approvalPin?: string }): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const approvedById = await approveWithPin(prisma, clock, user, input.approvalPin);
    await prisma.$transaction(async (tx) => {
      await lockBill(tx, billId);
      const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { lines: true } });
      if (bill.status !== 'PAID') throw conflict('BILL_NOT_PAID', 'Hanya bill lunas yang bisa di-void');
      const shift = await requireOpenShift(tx);
      for (const [productId, qty] of stockQtyByProduct(bill.lines)) {
        await tx.product.update({ where: { id: productId }, data: { stockQty: { increment: qty } } });
        await tx.stockMovement.create({ data: { productId, qty, reason: 'VOID', billId, userId: user.id } });
      }
      await tx.bill.update({
        where: { id: billId },
        data: { status: 'VOID', voidReason: input.reason, voidedById: user.id, voidedAt: clock.now(), voidShiftId: shift.id },
      });
      await audit(tx, { userId: user.id, action: 'bill.void', entity: 'Bill', entityId: billId, approvedById, data: { reason: input.reason, grandTotal: bill.grandTotal } });
    });
    this.ctx.bus.emit('bill.changed', billId);
    this.ctx.bus.emit('shift.changed');
    return loadBillView(prisma, billId);
  }
}
