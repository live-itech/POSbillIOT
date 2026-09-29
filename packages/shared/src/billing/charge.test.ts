import { describe, expect, it } from 'vitest';
import { computeTimeCharge, roundUpMinutes, type ComputeTimeChargeInput } from './charge';
import { ALL_DAYS, dayBit, NoTariffError, type TariffRule } from './tariff';

const WIB = 420;
const wib = (date: string, hhmm: string) => new Date(new Date(`${date}T${hhmm}:00Z`).getTime() - WIB * 60_000);
const day: TariffRule = { id: 'reg-day', unitTypeId: 'reg', name: 'Reguler Siang', daysMask: ALL_DAYS, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 };
const night: TariffRule = { id: 'reg-night', unitTypeId: 'reg', name: 'Reguler Malam', daysMask: ALL_DAYS, startMin: 1080, endMin: 480, pricePerHour: 50000, priority: 0 };
const weekend: TariffRule = { id: 'reg-weekend', unitTypeId: 'reg', name: 'Reguler Weekend', daysMask: dayBit(0) | dayBit(6), startMin: 0, endMin: 1440, pricePerHour: 60000, priority: 10 };
const rounding = { blockMin: 15, minChargeMin: 60 };

function charge(start: Date, end: Date, extra: Partial<ComputeTimeChargeInput> = {}) {
  return computeTimeCharge({
    intervals: [{ unitTypeId: 'reg', start, end }],
    anchor: { unitTypeId: 'reg', at: start },
    tariffs: [day, night],
    rounding,
    utcOffsetMin: WIB,
    ...extra,
  });
}

describe('roundUpMinutes', () => {
  it('membulatkan ke atas per menit lalu per blok', () => {
    expect(roundUpMinutes(61 * 60_000, { blockMin: 15, minChargeMin: 0 }, true)).toBe(75);
    expect(roundUpMinutes(60 * 60_000, { blockMin: 15, minChargeMin: 0 }, true)).toBe(60);
    expect(roundUpMinutes(1, { blockMin: 1, minChargeMin: 0 }, true)).toBe(1);
  });
  it('menerapkan minimum hanya jika diminta', () => {
    expect(roundUpMinutes(0, rounding, true)).toBe(60);
    expect(roundUpMinutes(0, rounding, false)).toBe(0);
  });
});

describe('computeTimeCharge — open billing', () => {
  it('menerapkan minimum main', () => {
    const c = charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '10:17'));
    expect(c).toEqual({
      billableMinutes: 17,
      chargedMinutes: 60,
      total: 40000,
      lines: [{ kind: 'TARIFF', label: 'Reguler Siang', tariffId: 'reg-day', unitTypeId: 'reg', pricePerHour: 40000, minutes: 60, amount: 40000 }],
    });
  });

  it('membulatkan ke blok 15 menit', () => {
    const c = charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '11:40'));
    expect(c.chargedMinutes).toBe(105);
    expect(c.total).toBe(70000);
  });

  it('memecah sesi yang melewati pergantian tarif', () => {
    const c = charge(wib('2026-10-01', '17:30'), wib('2026-10-01', '18:45'));
    expect(c.lines.map((l) => [l.label, l.minutes, l.amount])).toEqual([
      ['Reguler Siang', 30, 20000],
      ['Reguler Malam', 45, 37500],
    ]);
    expect(c.total).toBe(57500);
  });

  it('membebankan kelebihan pembulatan ke potongan terakhir', () => {
    const c = charge(wib('2026-10-01', '17:30'), wib('2026-10-01', '18:31'));
    expect(c.billableMinutes).toBe(61);
    expect(c.chargedMinutes).toBe(75);
    expect(c.lines.map((l) => [l.label, l.minutes, l.amount])).toEqual([
      ['Reguler Siang', 30, 20000],
      ['Reguler Malam', 45, 37500],
    ]);
  });

  it('menggabungkan potongan tarif sama yang terbelah tengah malam', () => {
    const c = charge(wib('2026-10-01', '23:00'), wib('2026-10-02', '01:00'));
    expect(c.lines.map((l) => [l.label, l.minutes, l.amount])).toEqual([['Reguler Malam', 120, 100000]]);
  });

  it('Friday night into Saturday: tarif weekend berprioritas mengambil alih setelah tengah malam', () => {
    const c = charge(wib('2026-10-02', '23:00'), wib('2026-10-03', '01:00'), { tariffs: [day, night, weekend] });
    expect(c.lines.map((l) => [l.label, l.minutes, l.amount])).toEqual([
      ['Reguler Malam', 60, 50000],
      ['Reguler Weekend', 60, 60000],
    ]);
    expect(c.total).toBe(110000);
  });

  it('menagih minimum saat belum ada waktu berjalan (pakai tarif di anchor)', () => {
    const c = computeTimeCharge({ intervals: [], anchor: { unitTypeId: 'reg', at: wib('2026-10-01', '10:00') }, tariffs: [day, night], rounding, utcOffsetMin: WIB });
    expect(c.total).toBe(40000);
    expect(c.chargedMinutes).toBe(60);
  });

  it('melempar NoTariffError jika tarif tidak ada', () => {
    expect(() => charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '11:00'), { tariffs: [] })).toThrow(NoTariffError);
  });
});

describe('computeTimeCharge — paket', () => {
  const pkg = { name: 'Paket 2 Jam', durationMin: 120, price: 90000 };
  it('menagih harga paket penuh walau berhenti lebih awal', () => {
    const c = charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '10:50'), { pkg });
    expect(c).toEqual({
      billableMinutes: 50,
      chargedMinutes: 120,
      total: 90000,
      lines: [{ kind: 'PACKAGE', label: 'Paket 2 Jam', tariffId: null, unitTypeId: null, pricePerHour: null, minutes: 120, amount: 90000 }],
    });
  });
  it('menagih tambahan waktu dengan tarif normal tanpa minimum', () => {
    const c = charge(wib('2026-10-01', '10:00'), wib('2026-10-01', '12:20'), { pkg });
    expect(c.lines.map((l) => [l.kind, l.minutes, l.amount])).toEqual([
      ['PACKAGE', 120, 90000],
      ['TARIFF', 30, 20000],
    ]);
    expect(c.total).toBe(110000);
    expect(c.chargedMinutes).toBe(150);
  });
});
