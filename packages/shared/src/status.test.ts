import { describe, expect, it } from 'vitest';
import { deriveUnitStatus, remainingMs } from './status';

const now = new Date('2026-10-01T03:00:00.000Z');
const inMin = (m: number) => new Date(now.getTime() + m * 60_000).toISOString();
const base = { maintenance: false, now, warnBeforeMin: 5 };

describe('deriveUnitStatus', () => {
  it('IDLE / MAINTENANCE tanpa sesi', () => {
    expect(deriveUnitStatus({ ...base, session: null })).toBe('IDLE');
    expect(deriveUnitStatus({ ...base, maintenance: true, session: null })).toBe('MAINTENANCE');
  });
  it('RUNNING untuk open billing', () => {
    expect(deriveUnitStatus({ ...base, session: { status: 'RUNNING', plannedEndAt: null } })).toBe('RUNNING');
  });
  it('WARNING saat sisa ≤ menit peringatan', () => {
    expect(deriveUnitStatus({ ...base, session: { status: 'RUNNING', plannedEndAt: inMin(10) } })).toBe('RUNNING');
    expect(deriveUnitStatus({ ...base, session: { status: 'RUNNING', plannedEndAt: inMin(4) } })).toBe('WARNING');
  });
  it('EXPIRED saat lewat plannedEndAt walau scheduler belum jalan', () => {
    expect(deriveUnitStatus({ ...base, session: { status: 'RUNNING', plannedEndAt: inMin(-1) } })).toBe('EXPIRED');
    expect(deriveUnitStatus({ ...base, session: { status: 'EXPIRED', plannedEndAt: inMin(-1) } })).toBe('EXPIRED');
  });
  it('PAUSED apa adanya', () => {
    expect(deriveUnitStatus({ ...base, session: { status: 'PAUSED', plannedEndAt: inMin(2) } })).toBe('PAUSED');
  });
});

describe('remainingMs', () => {
  it('membekukan sisa waktu saat pause', () => {
    const s = { status: 'PAUSED' as const, plannedEndAt: inMin(30), pauses: [{ pausedAt: inMin(-10), resumedAt: null }] };
    expect(remainingMs(s, now)).toBe(40 * 60_000);
  });
  it('null untuk open billing', () => {
    expect(remainingMs({ status: 'RUNNING', plannedEndAt: null }, now)).toBeNull();
  });
});
