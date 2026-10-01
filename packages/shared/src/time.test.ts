import { describe, expect, it } from 'vitest';
import { addMinutes, formatHHMM, localDateKey, localDayStart, localHHMM, localParts, parseHHMM } from './time';

const WIB = 420;

describe('localParts', () => {
  it('mengubah instan UTC ke hari & menit lokal WIB', () => {
    // 2026-10-02 11:30 UTC = Jumat 18:30 WIB
    expect(localParts(new Date('2026-10-02T11:30:00Z'), WIB)).toEqual({ dow: 5, minuteOfDay: 1110 });
  });
  it('berpindah ke hari lokal berikutnya setelah tengah malam WIB', () => {
    // 2026-10-02 17:15 UTC = Sabtu 00:15 WIB
    expect(localParts(new Date('2026-10-02T17:15:00Z'), WIB)).toEqual({ dow: 6, minuteOfDay: 15 });
  });
  it('menyimpan pecahan menit', () => {
    expect(localParts(new Date('2026-10-02T11:30:30Z'), WIB).minuteOfDay).toBe(1110.5);
  });
});

describe('localDayStart / localDateKey / localHHMM', () => {
  it('memberi awal hari lokal', () => {
    expect(localDayStart(new Date('2026-10-02T17:15:00Z'), WIB).toISOString()).toBe('2026-10-02T17:00:00.000Z');
  });
  it('memberi kunci tanggal lokal', () => {
    expect(localDateKey(new Date('2026-10-02T17:15:00Z'), WIB)).toBe('20261003');
  });
  it('memberi jam lokal HH:MM', () => {
    expect(localHHMM(new Date('2026-10-02T11:30:59Z'), WIB)).toBe('18:30');
  });
});

describe('parseHHMM / formatHHMM / addMinutes', () => {
  it('parse & format bolak-balik', () => {
    expect(parseHHMM('18:00')).toBe(1080);
    expect(parseHHMM('24:00')).toBe(1440);
    expect(formatHHMM(1080)).toBe('18:00');
    expect(formatHHMM(1440)).toBe('24:00');
    expect(formatHHMM(65)).toBe('01:05');
  });
  it('menolak format salah', () => {
    expect(() => parseHHMM('7:05')).toThrow();
    expect(() => parseHHMM('24:30')).toThrow();
    expect(() => parseHHMM('12:60')).toThrow();
  });
  it('menambah menit', () => {
    expect(addMinutes(new Date('2026-10-01T03:00:00Z'), 90).toISOString()).toBe('2026-10-01T04:30:00.000Z');
  });
});
