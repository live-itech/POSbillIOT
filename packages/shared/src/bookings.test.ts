import { describe, expect, it } from 'vitest';
import { bookingsOverlap, bookingWindow, holdStartsAt, isNoShowDue, isOnHold } from './bookings';
import { memberLabel } from './members';

const at = '2026-10-01T12:00:00.000Z'; // 19:00 WIB

describe('bookingWindow & bookingsOverlap', () => {
  it('jendela [mulai, mulai + durasi)', () => {
    const w = bookingWindow(at, 90);
    expect(w.start.toISOString()).toBe(at);
    expect(w.end.toISOString()).toBe('2026-10-01T13:30:00.000Z');
  });

  it('tumpang tindih, bersebelahan tidak', () => {
    const a = { startAt: at, durationMin: 60 };
    expect(bookingsOverlap(a, { startAt: '2026-10-01T12:30:00.000Z', durationMin: 60 })).toBe(true);
    expect(bookingsOverlap(a, { startAt: '2026-10-01T11:30:00.000Z', durationMin: 120 })).toBe(true); // mencakup
    expect(bookingsOverlap(a, { startAt: at, durationMin: 30 })).toBe(true);
    expect(bookingsOverlap(a, { startAt: '2026-10-01T13:00:00.000Z', durationMin: 30 })).toBe(false); // mulai tepat saat a selesai
    expect(bookingsOverlap(a, { startAt: '2026-10-01T11:00:00.000Z', durationMin: 60 })).toBe(false); // selesai tepat saat a mulai
  });
});

describe('hold & no-show', () => {
  const b = { status: 'BOOKED' as const, startAt: at };
  it('hold mulai holdMin sebelum jadwal dan bertahan selama BOOKED', () => {
    expect(isOnHold(b, new Date('2026-10-01T11:44:59.000Z'), 15)).toBe(false);
    expect(isOnHold(b, new Date('2026-10-01T11:45:00.000Z'), 15)).toBe(true);
    expect(isOnHold(b, new Date('2026-10-01T13:00:00.000Z'), 15)).toBe(true);
    expect(isOnHold({ ...b, status: 'CHECKED_IN' }, new Date('2026-10-01T12:00:00.000Z'), 15)).toBe(false);
    expect(holdStartsAt(at, 15).toISOString()).toBe('2026-10-01T11:45:00.000Z');
  });

  it('no-show jatuh tempo noShowMin setelah jadwal', () => {
    expect(isNoShowDue(b, new Date('2026-10-01T12:14:59.000Z'), 15)).toBe(false);
    expect(isNoShowDue(b, new Date('2026-10-01T12:15:00.000Z'), 15)).toBe(true);
    expect(isNoShowDue({ ...b, status: 'CANCELLED' }, new Date('2026-10-01T13:00:00.000Z'), 15)).toBe(false);
  });
});

describe('memberLabel', () => {
  it('nama (level)', () => {
    expect(memberLabel({ name: 'Sinta', levelName: 'Gold' })).toBe('Sinta (Gold)');
  });
});
