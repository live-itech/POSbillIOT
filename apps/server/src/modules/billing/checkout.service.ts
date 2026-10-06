import { Prisma } from '@prisma/client';
import { checkPayments, needsDiscountApproval, type BillView, type CheckoutResult, type PaymentInput, type PublicUser } from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { lockBooking } from '../bookings/booking-lock';
import { getSettings } from '../settings/settings.service';
import { requireOpenShift } from '../shifts/shifts.service';
import { bookingOfBill, linesTotals, loadBillView, lockBill } from './bill-view';

export interface CheckoutInput { idempotencyKey: string; expectedGrandTotal: number; payments: PaymentInput[]; approvalPin?: string }
/** Booking yang tersentuh transaksi, untuk event setelah commit. */
export interface BookingTouch { bookingId: string; unitId: string }
interface Outcome { billId: string; change: number; depositChange: number; touched: BookingTouch | null }

/** Jumlah per produk stok di bill (baris produk sama bisa lebih dari satu bila harganya berbeda). */
// Urutkan per produk agar UPDATE baris Product tidak saling kunci terbalik antar checkout paralel.
const sortedStockQty = (lines: { type: string; productId: string | null; qty: number }[]) =>
  [...stockQtyByProduct(lines)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

function stockQtyByProduct(lines: { type: string; productId: string | null; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (l.type === 'PRODUCT' && l.productId) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
  return m;
}

const changeOf = (payments: { method: string; change: number | null }[], method: 'CASH' | 'DEPOSIT') =>
  payments.filter((p) => p.method === method).reduce((a, p) => a + (p.change ?? 0), 0);

export class CheckoutService {
  constructor(private readonly ctx: AppContext) {}

  /** Hasil checkout sebelumnya untuk key ini (null bila belum ada). */
  private async prior(db: Db, billId: string, key: string): Promise<Outcome | null> {
    const b = await db.bill.findUnique({ where: { checkoutKey: key }, include: { payments: true } });
    if (!b) return null;
    if (b.id !== billId) throw conflict('REQUEST_ID_USED', 'ID pembayaran sudah dipakai untuk bill lain');
    return { billId: b.id, change: changeOf(b.payments, 'CASH'), depositChange: changeOf(b.payments, 'DEPOSIT'), touched: null };
  }

  async checkout(user: PublicUser, billId: string, input: CheckoutInput): Promise<CheckoutResult> {
    const { prisma, clock } = this.ctx;
    const finish = async (r: Outcome): Promise<CheckoutResult> => ({ bill: await loadBillView(prisma, r.billId), change: r.change, depositChange: r.depositChange });

    const done = await this.prior(prisma, billId, input.idempotencyKey);
    if (done) return finish(done);

    const settings = await getSettings(prisma);
    const pre = await prisma.bill.findUnique({ where: { id: billId }, include: { lines: true } });
    if (!pre) throw notFound('Bill');
    // PIN diverifikasi di luar transaksi (approveWithPin menulis ke tabel User).
    const approvedById = needsDiscountApproval(linesTotals(pre, settings), settings.discountApprovalPct)
      ? await approveWithPin(prisma, clock, user, input.approvalPin)
      : null;

    let result: Outcome;
    let replay = false;
    try {
      result = await prisma.$transaction(async (tx) => {
        await lockBill(tx, billId);
        const again = await this.prior(tx, billId, input.idempotencyKey); // request kembar yang baru selesai
        if (again) {
          replay = true;
          return again;
        }
        const bill = await tx.bill.findUniqueOrThrow({
          where: { id: billId },
          include: { lines: true, sessions: { where: { status: { not: 'ENDED' } }, select: { id: true } } },
        });
        if (bill.status !== 'OPEN') throw conflict('BILL_NOT_OPEN', 'Bill sudah dibayar atau dibatalkan');
        if (bill.sessions.length) throw conflict('SESSION_ACTIVE', 'Hentikan sesi meja terlebih dahulu');
        if (!bill.lines.length) throw badRequest('BILL_EMPTY', 'Bill masih kosong');

        // Urutan kunci: Bill → Booking → Shift (share) → Product. Status DP diperiksa ulang di bawah kunci booking.
        let touched: BookingTouch | null = null;
        let deposit: number | null = null;
        const bk = await bookingOfBill(tx, bill);
        if (bk) {
          await lockBooking(tx, bk.id);
          const fresh = await tx.booking.findUniqueOrThrow({ where: { id: bk.id } });
          touched = { bookingId: fresh.id, unitId: fresh.unitId };
          if (bill.kind === 'DEPOSIT' && fresh.status !== 'BOOKED') throw conflict('BOOKING_NOT_ACTIVE', 'Booking sudah tidak aktif');
          if (bill.kind === 'SALE' && input.payments.some((p) => p.method === 'DEPOSIT')) {
            const dep = fresh.depositBillId ? await tx.bill.findUnique({ where: { id: fresh.depositBillId }, select: { status: true } }) : null;
            if (fresh.depositAmount <= 0 || dep?.status !== 'PAID' || fresh.depositOutcome !== null) {
              throw conflict('DEPOSIT_NOT_AVAILABLE', 'DP booking sudah tidak tersedia');
            }
            deposit = fresh.depositAmount;
          }
        }
        const shift = await requireOpenShift(tx, { lock: true });

        const totals = linesTotals(bill, settings);
        if (totals.grandTotal !== input.expectedGrandTotal) throw conflict('TOTAL_CHANGED', 'Total tagihan berubah. Periksa kembali sebelum membayar.');
        if (needsDiscountApproval(totals, settings.discountApprovalPct) && !approvedById) {
          throw conflict('TOTAL_CHANGED', 'Diskon berubah. Periksa kembali sebelum membayar.');
        }
        const pay = checkPayments(totals.grandTotal, input.payments, { deposit });
        if (!pay.ok) throw badRequest(pay.code, pay.message);

        const now = clock.now();
        for (const p of pay.payments) {
          await tx.payment.create({
            data: { billId, shiftId: shift.id, method: p.method, amount: p.amount, received: p.received, change: p.change, reference: p.reference, createdAt: now },
          });
        }
        const usedDeposit = pay.payments.find((p) => p.method === 'DEPOSIT');
        if (usedDeposit && touched) {
          await tx.booking.update({ where: { id: touched.bookingId }, data: { depositOutcome: 'USED', depositUsedAmount: usedDeposit.amount } });
        }
        for (const [productId, qty] of sortedStockQty(bill.lines)) {
          await tx.product.update({ where: { id: productId }, data: { stockQty: { decrement: qty } } });
          await tx.stockMovement.create({ data: { productId, qty: -qty, reason: 'SALE', billId, userId: user.id, createdAt: now } });
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
          data: {
            grandTotal: totals.grandTotal, discountTotal: totals.discountTotal, memberDiscountTotal: totals.memberDiscountTotal,
            change: pay.change, depositChange: pay.depositChange, bookingId: touched?.bookingId ?? null,
            payments: pay.payments.map((p) => ({ method: p.method, amount: p.amount })),
          },
        });
        return { billId, change: pay.change, depositChange: pay.depositChange, touched };
      });
    } catch (err) {
      // Dua request kembar lolos bersamaan: yang kalah menabrak unik checkoutKey → kembalikan hasil pemenang.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target ?? '').includes('checkoutKey')) {
        const won = await this.prior(prisma, billId, input.idempotencyKey);
        if (won) return finish(won);
      }
      throw err;
    }

    if (!replay) {
      this.ctx.bus.emit('bill.changed', billId);
      this.ctx.bus.emit('shift.changed');
      if (result.touched) {
        this.ctx.bus.emit('booking.changed', result.touched.bookingId);
        this.ctx.bus.emit('unit.changed', result.touched.unitId); // ikon DP di kartu meja
      }
      this.ctx.printing.later(() => this.ctx.printing.printReceipt(user.id, billId));
    }
    return finish(result);
  }

  async void(user: PublicUser, billId: string, input: { reason: string; approvalPin?: string }): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const approvedById = await approveWithPin(prisma, clock, user, input.approvalPin);
    const touched = await prisma.$transaction((tx) => this.voidTx(tx, user, billId, input.reason, approvedById));
    this.afterVoid(billId, touched);
    return loadBillView(prisma, billId);
  }

  /** Event setelah void di-commit. */
  afterVoid(billId: string, touched: BookingTouch | null): void {
    this.ctx.bus.emit('bill.changed', billId);
    this.ctx.bus.emit('shift.changed');
    if (touched) {
      this.ctx.bus.emit('booking.changed', touched.bookingId);
      this.ctx.bus.emit('unit.changed', touched.unitId);
    }
  }

  /**
   * Void bill PAID di dalam transaksi pemanggil (dipakai juga batal booking & kembalikan DP).
   * Urutan kunci: Bill → Booking → Shift (share) → Product. Bill DEPOSIT hanya bila DP belum dipakai;
   * bill SALE yang dibayar dengan DEPOSIT mengembalikan DP secara tunai. Keduanya → depositOutcome REFUNDED.
   */
  async voidTx(tx: Db, user: PublicUser, billId: string, reason: string, approvedById: string): Promise<BookingTouch | null> {
    await lockBill(tx, billId);
    const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { lines: true, payments: true } });
    if (bill.status !== 'PAID') throw conflict('BILL_NOT_PAID', 'Hanya bill lunas yang bisa di-void');
    let touched: BookingTouch | null = null;
    const bk = await bookingOfBill(tx, bill);
    if (bk) {
      await lockBooking(tx, bk.id);
      const fresh = await tx.booking.findUniqueOrThrow({ where: { id: bk.id } });
      touched = { bookingId: fresh.id, unitId: fresh.unitId };
      if (bill.kind === 'DEPOSIT') {
        if (fresh.depositOutcome === 'USED') throw conflict('DEPOSIT_USED', 'DP sudah dipakai di bill penjualan. Void bill penjualannya.');
        await tx.booking.update({ where: { id: fresh.id }, data: { depositOutcome: 'REFUNDED' } });
      } else if (bill.payments.some((p) => p.method === 'DEPOSIT')) {
        await tx.booking.update({ where: { id: fresh.id }, data: { depositOutcome: 'REFUNDED' } });
      }
    }
    const shift = await requireOpenShift(tx, { lock: true });
    const now = this.ctx.clock.now();
    for (const [productId, qty] of sortedStockQty(bill.lines)) {
      await tx.product.update({ where: { id: productId }, data: { stockQty: { increment: qty } } });
      await tx.stockMovement.create({ data: { productId, qty, reason: 'VOID', billId, userId: user.id, createdAt: now } });
    }
    await tx.bill.update({
      where: { id: billId },
      data: { status: 'VOID', voidReason: reason, voidedById: user.id, voidedAt: now, voidShiftId: shift.id },
    });
    await audit(tx, {
      userId: user.id, action: 'bill.void', entity: 'Bill', entityId: billId, approvedById,
      data: { reason, grandTotal: bill.grandTotal, bookingId: touched?.bookingId ?? null },
    });
    return touched;
  }
}
