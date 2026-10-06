import {
  addMinutes, bookingsOverlap, bookingWindow, formatReceiptDate, holdStartsAt, isNoShowDue, isOnHold, localHHMM,
  type BookingStatus, type BookingView, type CreateBookingResult, type PublicSettings, type PublicUser, type SessionMode,
} from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { emitAlert } from '../../lib/alerts';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { lockBill } from '../billing/bill-view';
import { requireActiveMember } from '../members/members.service';
import { nextBillNumber, rethrowBusy } from '../sessions/sessions.service';
import { getSettings } from '../settings/settings.service';
import { requireOpenShift } from '../shifts/shifts.service';
import { lockBooking } from './booking-lock';
import { bookingInclude, loadBookingView, toBookingViews } from './booking-view';

/** Durasi booking maksimum (menit); juga batas jendela pencarian bentrok. */
export const MAX_BOOKING_MIN = 720;

export interface BookingInput {
  unitId: string;
  startAt: Date;
  durationMin: number;
  customerName?: string;
  phone?: string;
  memberId?: string | null;
  note?: string;
  depositAmount: number;
}
export type BookingPatch = Partial<Omit<BookingInput, 'depositAmount'>>;

/** Kunci baris Unit — hanya dipakai buat/ubah jadwal booking. */
async function lockUnit(tx: Db, unitId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Unit" WHERE id = ${unitId} FOR UPDATE`;
  if (!rows.length) throw notFound('Meja');
  return tx.unit.findUniqueOrThrow({ where: { id: unitId } });
}

/** Nama & HP pelanggan dari input, dilengkapi data member bila `memberId` diisi. */
async function customerOf(tx: Db, input: { customerName?: string; phone?: string; memberId?: string | null }) {
  if (input.memberId) {
    const m = await requireActiveMember(tx, input.memberId);
    return { name: input.customerName?.trim() || m.name, phone: input.phone?.trim() || m.phone, memberId: m.id };
  }
  const name = input.customerName?.trim() ?? '';
  if (!name) throw badRequest('CUSTOMER_REQUIRED', 'Nama pelanggan wajib diisi');
  return { name, phone: input.phone?.trim() ?? '', memberId: null };
}

/** Tolak bila ada booking BOOKED lain di meja yang sama yang jendelanya beririsan. Pemanggil memegang kunci Unit. */
async function assertNoConflict(tx: Db, unitId: string, startAt: Date, durationMin: number, exceptId: string | null, utcOffsetMin: number) {
  const { end } = bookingWindow(startAt, durationMin);
  const near = await tx.booking.findMany({
    where: {
      unitId,
      status: 'BOOKED',
      startAt: { gt: addMinutes(startAt, -MAX_BOOKING_MIN), lt: end },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    orderBy: { startAt: 'asc' },
  });
  const clash = near.find((x) => bookingsOverlap(x, { startAt, durationMin }));
  if (clash) throw conflict('BOOKING_CONFLICT', `Jadwal bentrok dengan booking ${clash.customerName} jam ${localHHMM(clash.startAt, utcOffsetMin)}`);
}

export class BookingService {
  constructor(private readonly ctx: AppContext) {}

  /** Setelah commit: daftar booking dan kartu meja (hold) di klien diperbarui. */
  changed(bookingId: string, ...unitIds: (string | null | undefined)[]): void {
    this.ctx.bus.emit('booking.changed', bookingId);
    for (const id of new Set(unitIds.filter((x): x is string => !!x))) this.ctx.bus.emit('unit.changed', id);
  }

  async list(filter: { from: Date; to: Date; status?: BookingStatus }): Promise<BookingView[]> {
    const rows = await this.ctx.prisma.booking.findMany({
      where: { startAt: { gte: filter.from, lt: filter.to }, ...(filter.status ? { status: filter.status } : {}) },
      include: bookingInclude,
      orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
    });
    return toBookingViews(this.ctx.prisma, rows);
  }

  get(id: string): Promise<BookingView> {
    return loadBookingView(this.ctx.prisma, id);
  }

  async create(user: PublicUser, input: BookingInput): Promise<CreateBookingResult> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const off = settings.utcOffsetMin;
    if (bookingWindow(input.startAt, input.durationMin).end.getTime() <= now.getTime()) {
      throw badRequest('BOOKING_IN_PAST', 'Jadwal booking sudah lewat');
    }
    const r = await prisma.$transaction(async (tx) => {
      // Nomor bill (BillCounter) diambil sebelum kunci Unit — urutannya sama dengan mulai sesi
      // (buat bill dulu, baru memperbarui Unit), sehingga tidak ada siklus kunci.
      const billNumber = input.depositAmount > 0 ? await nextBillNumber(tx, now, off) : null;
      if (billNumber) await requireOpenShift(tx);
      const unit = await lockUnit(tx, input.unitId);
      if (unit.state !== 'ACTIVE') throw conflict('UNIT_MAINTENANCE', `${unit.name} sedang maintenance`);
      const who = await customerOf(tx, input);
      await assertNoConflict(tx, unit.id, input.startAt, input.durationMin, null, off);
      const booking = await tx.booking.create({
        data: {
          unitId: unit.id,
          customerName: who.name,
          phone: who.phone,
          memberId: who.memberId,
          startAt: input.startAt,
          durationMin: input.durationMin,
          note: input.note?.trim() ?? '',
          depositAmount: input.depositAmount,
          createdById: user.id,
        },
      });
      let depositBillId: string | null = null;
      if (billNumber) {
        const bill = await tx.bill.create({
          data: {
            number: billNumber,
            label: `DP · ${who.name} · ${unit.name} ${localHHMM(input.startAt, off)}`,
            kind: 'DEPOSIT',
            createdById: user.id,
            lines: {
              create: {
                type: 'DEPOSIT',
                nameSnapshot: `DP booking ${unit.name} ${formatReceiptDate(input.startAt, off)}`,
                unitPrice: input.depositAmount,
                qty: 1,
                createdById: user.id,
              },
            },
          },
        });
        depositBillId = bill.id;
        await tx.booking.update({ where: { id: booking.id }, data: { depositBillId } });
      }
      await audit(tx, {
        userId: user.id, action: 'booking.create', entity: 'Booking', entityId: booking.id,
        data: { unitId: unit.id, startAt: input.startAt.toISOString(), durationMin: input.durationMin, depositAmount: input.depositAmount, memberId: who.memberId },
      });
      return { id: booking.id, unitId: unit.id, depositBillId };
    });
    this.changed(r.id, r.unitId);
    if (r.depositBillId) this.ctx.bus.emit('bill.changed', r.depositBillId);
    return { booking: await loadBookingView(prisma, r.id), depositBillId: r.depositBillId };
  }

  async update(user: PublicUser, id: string, input: BookingPatch): Promise<BookingView> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const off = settings.utcOffsetMin;
    const r = await prisma.$transaction(async (tx) => {
      // urutan kunci: Booking → Unit (check-in juga Booking → Unit lewat mulai sesi)
      await lockBooking(tx, id);
      const bk = await tx.booking.findUniqueOrThrow({ where: { id } });
      if (bk.status !== 'BOOKED') throw conflict('BOOKING_NOT_ACTIVE', 'Booking sudah tidak aktif');
      const unitId = input.unitId ?? bk.unitId;
      for (const u of [...new Set([bk.unitId, unitId])].sort()) await lockUnit(tx, u);
      const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
      const startAt = input.startAt ?? bk.startAt;
      const durationMin = input.durationMin ?? bk.durationMin;
      const rescheduled = unitId !== bk.unitId || startAt.getTime() !== bk.startAt.getTime();
      if (rescheduled || durationMin !== bk.durationMin) {
        if (unit.state !== 'ACTIVE') throw conflict('UNIT_MAINTENANCE', `${unit.name} sedang maintenance`);
        if (bookingWindow(startAt, durationMin).end.getTime() <= now.getTime()) throw badRequest('BOOKING_IN_PAST', 'Jadwal booking sudah lewat');
        await assertNoConflict(tx, unitId, startAt, durationMin, id, off);
      }
      const who =
        input.customerName !== undefined || input.phone !== undefined || input.memberId !== undefined
          ? await customerOf(tx, {
              customerName: input.customerName ?? bk.customerName,
              phone: input.phone ?? bk.phone,
              memberId: input.memberId === undefined ? bk.memberId : input.memberId,
            })
          : { name: bk.customerName, phone: bk.phone, memberId: bk.memberId };
      await tx.booking.update({
        where: { id },
        data: {
          unitId, startAt, durationMin, customerName: who.name, phone: who.phone, memberId: who.memberId,
          ...(input.note !== undefined ? { note: input.note.trim() } : {}),
          ...(rescheduled ? { holdNotifiedAt: null } : {}),
        },
      });
      await audit(tx, {
        userId: user.id, action: 'booking.update', entity: 'Booking', entityId: id,
        data: {
          from: { unitId: bk.unitId, startAt: bk.startAt.toISOString(), durationMin: bk.durationMin },
          to: { unitId, startAt: startAt.toISOString(), durationMin },
        },
      });
      return { from: bk.unitId, to: unitId };
    });
    this.changed(id, r.from, r.to);
    return loadBookingView(prisma, id);
  }

  /**
   * Check-in: mulai sesi (Open/Paket) dengan bill SALE baru yang terhubung ke booking & member booking.
   * Urutan kunci: bill DEPOSIT → Booking → (mulai sesi: BillCounter, Unit). Bill DP yang belum dibayar dibatalkan.
   */
  async checkIn(user: PublicUser, id: string, input: { mode: SessionMode; packageId?: string }): Promise<{ unitId: string }> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const pre = await prisma.booking.findUnique({ where: { id }, include: { unit: { select: { name: true } } } });
    if (!pre) throw notFound('Booking');
    let r: { unitId: string; cancelledDepositBillId: string | null };
    try {
      r = await prisma.$transaction(async (tx) => {
        if (pre.depositBillId) await lockBill(tx, pre.depositBillId);
        await lockBooking(tx, id);
        const bk = await tx.booking.findUniqueOrThrow({ where: { id } });
        if (bk.status !== 'BOOKED') throw conflict('BOOKING_NOT_ACTIVE', 'Booking sudah tidak aktif');
        if (!isOnHold(bk, now, settings.bookingHoldMin)) {
          throw conflict('BOOKING_TOO_EARLY', `Check-in baru bisa mulai ${localHHMM(holdStartsAt(bk.startAt, settings.bookingHoldMin), settings.utcOffsetMin)}`);
        }
        let cancelledDepositBillId: string | null = null;
        if (bk.depositBillId) {
          const dep = await tx.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } });
          if (dep.status === 'OPEN') {
            await tx.bill.update({ where: { id: dep.id }, data: { status: 'CANCELLED', cancelReason: 'DP tidak dibayar saat check-in' } });
            cancelledDepositBillId = dep.id;
          }
        }
        const session = await this.ctx.sessions.startTx(
          tx, user,
          { unitId: bk.unitId, mode: input.mode, packageId: input.packageId, memberId: bk.memberId },
          { now, settings },
          { bookingId: bk.id },
        );
        await tx.booking.update({ where: { id }, data: { status: 'CHECKED_IN', saleBillId: session.billId } });
        await audit(tx, { userId: user.id, action: 'booking.check_in', entity: 'Booking', entityId: id, data: { sessionId: session.id, billId: session.billId } });
        return { unitId: bk.unitId, cancelledDepositBillId };
      });
    } catch (err) {
      rethrowBusy(err, pre.unit.name);
    }
    this.ctx.sessions.touch(r.unitId);
    this.changed(id);
    if (r.cancelledDepositBillId) this.ctx.bus.emit('bill.changed', r.cancelledDepositBillId);
    return { unitId: r.unitId };
  }

  /**
   * Batalkan booking BOOKED. Urutan kunci: bill DEPOSIT → Booking → (void: Shift). Bill DP yang masih OPEN
   * ikut dibatalkan; DP yang sudah dibayar hangus (FORFEIT) atau dikembalikan lewat void bill DEPOSIT (REFUND).
   */
  async cancel(user: PublicUser, id: string, input: { reason: string; deposit: 'FORFEIT' | 'REFUND'; approvalPin?: string }): Promise<BookingView> {
    const { prisma, clock } = this.ctx;
    const pre = await prisma.booking.findUnique({ where: { id } });
    if (!pre) throw notFound('Booking');
    const depPre = pre.depositBillId ? await prisma.bill.findUnique({ where: { id: pre.depositBillId }, select: { status: true } }) : null;
    // PIN di luar transaksi (approveWithPin menulis ke tabel User); status DP diperiksa ulang di bawah kunci.
    const approvedById = depPre?.status === 'PAID' ? await approveWithPin(prisma, clock, user, input.approvalPin) : null;
    const r = await prisma.$transaction(async (tx) => {
      if (pre.depositBillId) await lockBill(tx, pre.depositBillId);
      await lockBooking(tx, id);
      const bk = await tx.booking.findUniqueOrThrow({ where: { id } });
      if (bk.status !== 'BOOKED') throw conflict('BOOKING_NOT_ACTIVE', 'Booking sudah tidak aktif');
      const dep = bk.depositBillId ? await tx.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } }) : null;
      let outcome = bk.depositOutcome;
      let voided = false;
      if (dep?.status === 'OPEN') {
        await tx.bill.update({ where: { id: dep.id }, data: { status: 'CANCELLED', cancelReason: `Booking dibatalkan: ${input.reason}` } });
      }
      const dpPaid = dep?.status === 'PAID' && bk.depositOutcome === null;
      if (dep && dpPaid) {
        if (!approvedById) throw new AppError(403, 'APPROVAL_REQUIRED', 'Aksi ini butuh PIN supervisor');
        if (input.deposit === 'REFUND') {
          await this.ctx.checkout.voidTx(tx, user, dep.id, `Booking dibatalkan: ${input.reason}`, approvedById);
          outcome = 'REFUNDED';
          voided = true;
        } else {
          outcome = 'FORFEITED';
        }
      }
      await tx.booking.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: input.reason, depositOutcome: outcome } });
      await audit(tx, {
        userId: user.id, action: 'booking.cancel', entity: 'Booking', entityId: id, approvedById,
        data: { reason: input.reason, deposit: dpPaid ? input.deposit : null },
      });
      return { unitId: bk.unitId, depositBillId: bk.depositBillId, voided };
    });
    if (r.depositBillId) this.ctx.bus.emit('bill.changed', r.depositBillId);
    if (r.voided) this.ctx.bus.emit('shift.changed');
    this.changed(id, r.unitId);
    return loadBookingView(prisma, id);
  }

  /**
   * Kembalikan DP lewat void bill DEPOSIT (PIN untuk kasir). Boleh bila DP hangus (NO_SHOW/CANCELLED) atau
   * booking sudah check-in tetapi DP belum dipakai. Urutan kunci: bill DEPOSIT → Booking → Shift.
   */
  async refundDeposit(user: PublicUser, id: string, input: { reason: string; approvalPin?: string }): Promise<BookingView> {
    const { prisma, clock } = this.ctx;
    const pre = await prisma.booking.findUnique({ where: { id } });
    if (!pre) throw notFound('Booking');
    if (!pre.depositBillId) throw conflict('DEPOSIT_NOT_AVAILABLE', 'Booking ini tidak memakai DP');
    const depositBillId = pre.depositBillId;
    const approvedById = await approveWithPin(prisma, clock, user, input.approvalPin);
    const r = await prisma.$transaction(async (tx) => {
      await lockBill(tx, depositBillId);
      await lockBooking(tx, id);
      const bk = await tx.booking.findUniqueOrThrow({ where: { id } });
      const dep = await tx.bill.findUniqueOrThrow({ where: { id: depositBillId } });
      const forfeited = (bk.status === 'NO_SHOW' || bk.status === 'CANCELLED') && bk.depositOutcome === 'FORFEITED';
      const unusedAfterCheckIn = bk.status === 'CHECKED_IN' && bk.depositOutcome === null;
      if (dep.status !== 'PAID' || !(forfeited || unusedAfterCheckIn)) throw conflict('DEPOSIT_NOT_AVAILABLE', 'DP tidak bisa dikembalikan');
      await this.ctx.checkout.voidTx(tx, user, dep.id, `Pengembalian DP: ${input.reason}`, approvedById);
      await audit(tx, {
        userId: user.id, action: 'booking.refund_deposit', entity: 'Booking', entityId: id, approvedById,
        data: { reason: input.reason, amount: bk.depositAmount },
      });
      return { unitId: bk.unitId };
    });
    this.ctx.bus.emit('bill.changed', depositBillId);
    this.ctx.bus.emit('shift.changed');
    this.changed(id, r.unitId);
    return loadBookingView(prisma, id);
  }

  /** Dipanggil scheduler setiap tick: notifikasi saat hold dimulai (sekali), lalu no-show otomatis. */
  async runDue(now: Date, settings: PublicSettings): Promise<void> {
    const { prisma, clock, bus } = this.ctx;
    const upcoming = await prisma.booking.findMany({
      where: {
        status: 'BOOKED',
        holdNotifiedAt: null,
        startAt: { lte: addMinutes(now, settings.bookingHoldMin), gt: addMinutes(now, -settings.bookingNoShowMin) },
      },
      include: { unit: { select: { name: true } } },
    });
    for (const x of upcoming) {
      const w = await prisma.booking.updateMany({ where: { id: x.id, status: 'BOOKED', holdNotifiedAt: null, startAt: x.startAt }, data: { holdNotifiedAt: now } });
      if (w.count === 0) continue;
      emitAlert(bus, clock, {
        level: 'info', type: 'BOOKING_UPCOMING', unitId: x.unitId,
        message: `Booking ${x.customerName} di ${x.unit.name} jam ${localHHMM(x.startAt, settings.utcOffsetMin)}`,
      });
      this.changed(x.id, x.unitId);
    }
    const due = await prisma.booking.findMany({
      where: { status: 'BOOKED', startAt: { lte: addMinutes(now, -settings.bookingNoShowMin) } },
      select: { id: true },
    });
    for (const d of due) {
      try {
        await this.markNoShow(d.id, now, settings);
      } catch (err) {
        console.error(`[scheduler] no-show booking ${d.id} gagal`, err);
      }
    }
  }

  /** Urutan kunci: bill DEPOSIT → Booking; status diperiksa ulang (check-in/batal/ubah jadwal bisa menang). */
  private async markNoShow(id: string, now: Date, settings: PublicSettings): Promise<void> {
    const { prisma, clock, bus } = this.ctx;
    const pre = await prisma.booking.findUnique({ where: { id } });
    if (!pre) return;
    const r = await prisma.$transaction(async (tx) => {
      if (pre.depositBillId) await lockBill(tx, pre.depositBillId);
      await lockBooking(tx, id);
      const bk = await tx.booking.findUniqueOrThrow({ where: { id }, include: { unit: { select: { name: true } } } });
      if (!isNoShowDue(bk, now, settings.bookingNoShowMin)) return null;
      const dep = bk.depositBillId ? await tx.bill.findUniqueOrThrow({ where: { id: bk.depositBillId } }) : null;
      if (dep?.status === 'OPEN') {
        await tx.bill.update({ where: { id: dep.id }, data: { status: 'CANCELLED', cancelReason: 'Booking tidak datang (no-show)' } });
      }
      const forfeit = dep?.status === 'PAID' && bk.depositOutcome === null;
      await tx.booking.update({ where: { id }, data: { status: 'NO_SHOW', ...(forfeit ? { depositOutcome: 'FORFEITED' as const } : {}) } });
      await audit(tx, { userId: null, action: 'booking.no_show', entity: 'Booking', entityId: id, data: { depositForfeited: forfeit } });
      return {
        unitId: bk.unitId,
        message: `No-show: ${bk.customerName} di ${bk.unit.name} jam ${localHHMM(bk.startAt, settings.utcOffsetMin)}`,
        cancelledDepositBillId: dep?.status === 'OPEN' ? dep.id : null,
      };
    });
    if (!r) return;
    emitAlert(bus, clock, { level: 'warning', type: 'BOOKING_NO_SHOW', unitId: r.unitId, message: r.message });
    if (r.cancelledDepositBillId) bus.emit('bill.changed', r.cancelledDepositBillId);
    this.changed(id, r.unitId);
  }
}
