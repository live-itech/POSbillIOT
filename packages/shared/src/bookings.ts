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
