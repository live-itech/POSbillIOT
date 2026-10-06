import { describe, expect, it } from 'vitest';
import { blockPosition, nowPosition } from './timeline';

const day = new Date('2026-09-30T17:00:00.000Z'); // 1 Okt 2026 00:00 WIB

describe('timeline', () => {
  it('blok ditempatkan per menit dalam 24 jam dan dipotong di batas hari', () => {
    const a = blockPosition('2026-10-01T12:00:00.000Z', 60, day)!; // 19:00–20:00
    expect(a.leftPct).toBeCloseTo(79.17, 2);
    expect(a.widthPct).toBeCloseTo(4.17, 2);
    const late = blockPosition('2026-10-01T16:30:00.000Z', 90, day)!; // 23:30–01:00 → sampai 24:00
    expect(late.leftPct).toBeCloseTo(97.92, 2);
    expect(late.widthPct).toBeCloseTo(2.08, 2);
    const early = blockPosition('2026-09-30T16:00:00.000Z', 120, day)!; // 23:00 kemarin – 01:00
    expect(early).toEqual({ leftPct: 0, widthPct: (60 / 1440) * 100 });
    expect(blockPosition('2026-10-01T17:00:00.000Z', 60, day)).toBeNull(); // besok
  });

  it('garis sekarang hanya untuk hari yang dipilih', () => {
    expect(nowPosition(new Date('2026-10-01T03:00:00.000Z'), day)).toBeCloseTo(41.67, 2); // 10:00
    expect(nowPosition(new Date('2026-10-01T17:00:00.000Z'), day)).toBeNull();
  });
});
