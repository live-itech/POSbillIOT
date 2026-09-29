import { describe, expect, it } from 'vitest';
import { computeSessionCharge, sessionElapsedMs, type SessionLike } from './session-charge';
import { ALL_DAYS, type TariffRule } from './tariff';

const day: TariffRule = { id: 'reg-day', unitTypeId: 'reg', name: 'Reguler Siang', daysMask: ALL_DAYS, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 };
const settings = { utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60 };

// 03:00Z = 10:00 WIB. String ISO dipakai seperti SessionView dari server.
const session: SessionLike = {
  mode: 'PACKAGE',
  startedAt: '2026-10-01T03:00:00.000Z',
  endedAt: null,
  packageName: 'Paket 1 Jam',
  packageDurationMin: 60,
  packagePrice: 45000,
  segments: [{ unitTypeId: 'reg', startedAt: '2026-10-01T03:00:00.000Z', endedAt: null }],
  pauses: [{ pausedAt: '2026-10-01T03:20:00.000Z', resumedAt: '2026-10-01T03:30:00.000Z' }],
};
const now = new Date('2026-10-01T04:15:00.000Z'); // 11:15 WIB

describe('computeSessionCharge', () => {
  it('menghitung paket + sisa tanpa waktu pause', () => {
    const c = computeSessionCharge(session, [day], settings, now);
    expect(c.billableMinutes).toBe(65);
    expect(c.lines.map((l) => [l.kind, l.minutes, l.amount])).toEqual([
      ['PACKAGE', 60, 45000],
      ['TARIFF', 15, 10000],
    ]);
    expect(c.total).toBe(55000);
  });
  it('memakai endedAt bila ada, bukan now', () => {
    const c = computeSessionCharge({ ...session, endedAt: '2026-10-01T04:00:00.000Z' }, [day], settings, now);
    expect(c.total).toBe(45000);
  });
});

describe('sessionElapsedMs', () => {
  it('mengabaikan pause', () => {
    expect(sessionElapsedMs(session, now)).toBe(65 * 60_000);
  });
});
