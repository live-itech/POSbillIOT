import { describe, expect, it } from 'vitest';
import { formatDuration, formatMinutes, formatRupiah } from './format';

describe('format', () => {
  it('formatRupiah memakai titik ribuan', () => {
    expect(formatRupiah(86000)).toBe('Rp 86.000');
    expect(formatRupiah(1250000)).toBe('Rp 1.250.000');
    expect(formatRupiah(0)).toBe('Rp 0');
    expect(formatRupiah(-5000)).toBe('-Rp 5.000');
  });
  it('formatDuration HH:MM:SS', () => {
    expect(formatDuration(0)).toBe('00:00:00');
    expect(formatDuration(5_049_000)).toBe('01:24:09');
    expect(formatDuration(-10)).toBe('00:00:00');
  });
  it('formatMinutes ramah dibaca', () => {
    expect(formatMinutes(45)).toBe('45 menit');
    expect(formatMinutes(60)).toBe('1 jam');
    expect(formatMinutes(90)).toBe('1 jam 30 menit');
  });
});
