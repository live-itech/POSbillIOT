import { describe, expect, it } from 'vitest';
import { formatDuration, formatMinutes, formatRupiah, localDateInput, localDateTimeToIso, localDayRange, localTimeInput, parseRupiah } from './format';

describe('format', () => {
  it('formatRupiah memakai titik ribuan', () => {
    expect(formatRupiah(86000)).toBe('Rp 86.000');
    expect(formatRupiah(1250000)).toBe('Rp 1.250.000');
    expect(formatRupiah(0)).toBe('Rp 0');
    expect(formatRupiah(-5000)).toBe('-Rp 5.000');
  });
  it('parseRupiah hanya mengambil digit', () => {
    expect(parseRupiah('150.000')).toBe(150000);
    expect(parseRupiah('Rp 20.000')).toBe(20000);
    expect(parseRupiah('')).toBe(0);
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
  it('localDayRange: hari lokal outlet → rentang UTC', () => {
    expect(localDayRange('2026-10-01', 420)).toEqual({ from: '2026-09-30T17:00:00.000Z', to: '2026-10-01T17:00:00.000Z' });
    expect(localDateInput(new Date('2026-09-30T18:30:00Z'), 420)).toBe('2026-10-01');
  });
});

describe('waktu lokal outlet untuk booking', () => {
  it('tanggal + jam lokal → ISO UTC, dan sebaliknya', () => {
    expect(localDateTimeToIso('2026-10-01', '19:00', 420)).toBe('2026-10-01T12:00:00.000Z');
    expect(localDateTimeToIso('2026-10-02', '00:30', 420)).toBe('2026-10-01T17:30:00.000Z');
    expect(localTimeInput(new Date('2026-10-01T12:05:00Z'), 420)).toBe('19:05');
  });
});
