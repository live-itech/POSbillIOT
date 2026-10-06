import { addMinutes, MS_PER_MIN } from './time';
import type { BillStatus } from './transactions';
import type { UnitView } from './views';
export const BOOKING_STATUSES = ['BOOKED', 'CHECKED_IN', 'NO_SHOW', 'CANCELLED'] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  BOOKED: 'Dipesan',
  CHECKED_IN: 'Check-in',
  NO_SHOW: 'Tidak datang',
  CANCELLED: 'Dibatalkan',
};

export const DEPOSIT_OUTCOMES = ['USED', 'FORFEITED', 'REFUNDED'] as const;
export type DepositOutcome = (typeof DEPOSIT_OUTCOMES)[number];
export const DEPOSIT_OUTCOME_LABEL: Record<DepositOutcome, string> = { USED: 'DP terpakai', FORFEITED: 'DP hangus', REFUNDED: 'DP dikembalikan' };

export interface BookingSettings {
  /** Meja tampil Booked mulai sekian menit sebelum jadwal. */
  bookingHoldMin: number;
  /** Booking yang belum check-in sekian menit setelah jadwal menjadi no-show. */
  bookingNoShowMin: number;
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = { bookingHoldMin: 15, bookingNoShowMin: 15 };

type Instant = Date | string;
const ms = (t: Instant) => new Date(t).getTime();

export interface BookingTimeLike { startAt: Instant; durationMin: number }

/** Jendela booking [start, end): end eksklusif sehingga booking bersebelahan tidak bentrok. */
export function bookingWindow(startAt: Instant, durationMin: number): { start: Date; end: Date } {
  const start = new Date(startAt);
  return { start, end: addMinutes(start, durationMin) };
}

export function bookingsOverlap(a: BookingTimeLike, b: BookingTimeLike): boolean {
  const x = bookingWindow(a.startAt, a.durationMin);
  const y = bookingWindow(b.startAt, b.durationMin);
  return x.start.getTime() < y.end.getTime() && y.start.getTime() < x.end.getTime();
}

export const holdStartsAt = (startAt: Instant, holdMin: number): Date => addMinutes(new Date(startAt), -holdMin);

/** Meja di-hold sejak `holdMin` menit sebelum jadwal selama booking masih BOOKED (sampai check-in/batal/no-show). */
export function isOnHold(b: { status: BookingStatus; startAt: Instant }, now: Date, holdMin: number): boolean {
  return b.status === 'BOOKED' && now.getTime() >= ms(b.startAt) - holdMin * MS_PER_MIN;
}

/** Booking BOOKED yang belum check-in `noShowMin` menit setelah jadwal. */
export function isNoShowDue(b: { status: BookingStatus; startAt: Instant }, now: Date, noShowMin: number): boolean {
  return b.status === 'BOOKED' && now.getTime() >= ms(b.startAt) + noShowMin * MS_PER_MIN;
}

export interface BookingView {
  id: string;
  unitId: string;
  unitName: string;
  customerName: string;
  phone: string;
  memberId: string | null;
  memberCode: string | null;
  startAt: string;
  durationMin: number;
  note: string;
  status: BookingStatus;
  depositAmount: number;
  depositBillId: string | null;
  /** Status bill DEPOSIT: OPEN = DP belum dibayar, PAID = sudah dibayar, VOID = dikembalikan. */
  depositBillStatus: BillStatus | null;
  depositOutcome: DepositOutcome | null;
  depositUsedAmount: number;
  saleBillId: string | null;
  cancelReason: string | null;
  createdByName: string;
  createdAt: string;
}

/** Booking yang sedang menahan meja (kartu "Booked"). */
export interface UnitBookingView { id: string; customerName: string; startAt: string; durationMin: number; depositPaid: boolean }

/** `error.details.booking` pada 409 BOOKING_HOLD. */
export interface BookingHoldInfo { id: string; customerName: string; startAt: string }

/** Booking yang terhubung ke bill. `deposit` hanya untuk bill SALE booking ber-DP. */
export interface BillBookingView {
  id: string;
  customerName: string;
  startAt: string;
  status: BookingStatus;
  deposit: { amount: number; available: boolean } | null;
}

export interface CreateBookingResult { booking: BookingView; depositBillId: string | null }
export interface CheckInResult { unit: UnitView | null; booking: BookingView }
