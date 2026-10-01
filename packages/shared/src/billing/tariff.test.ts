import { describe, expect, it } from 'vitest';
import { ALL_DAYS, dayBit, daysToMask, findTariff, maskToDays, nextBoundary, NoTariffError, ruleCovers, type TariffRule } from './tariff';

const WIB = 420;
const wib = (date: string, hhmm: string) => new Date(new Date(`${date}T${hhmm}:00Z`).getTime() - WIB * 60_000);

const day: TariffRule = { id: 'reg-day', unitTypeId: 'reg', name: 'Reguler Siang', daysMask: ALL_DAYS, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 };
const night: TariffRule = { id: 'reg-night', unitTypeId: 'reg', name: 'Reguler Malam', daysMask: ALL_DAYS, startMin: 1080, endMin: 480, pricePerHour: 50000, priority: 0 };
const weekend: TariffRule = { id: 'reg-weekend', unitTypeId: 'reg', name: 'Reguler Weekend', daysMask: dayBit(0) | dayBit(6), startMin: 0, endMin: 1440, pricePerHour: 60000, priority: 10 };

describe('mask hari', () => {
  it('bolak-balik', () => {
    expect(daysToMask([0, 6])).toBe(65);
    expect(maskToDays(65)).toEqual([0, 6]);
    expect(maskToDays(ALL_DAYS)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe('ruleCovers', () => {
  const fridayNight: TariffRule = { ...night, id: 'fri', daysMask: dayBit(5), endMin: 120 };
  it('rentang lintas tengah malam berlaku di pagi hari berikutnya', () => {
    expect(ruleCovers(fridayNight, 6, 60)).toBe(true); // Sabtu 01:00 → masih rentang Jumat
  });
  it('tidak berlaku di pagi hari yang hari sebelumnya bukan hari rentang', () => {
    expect(ruleCovers(fridayNight, 4, 60)).toBe(false); // Kamis 01:00
    expect(ruleCovers(fridayNight, 5, 60)).toBe(false); // Jumat 01:00 (rentang Kamis tidak ada)
  });
});

describe('findTariff', () => {
  const rules = [day, night, weekend];
  it('memilih tarif siang & malam', () => {
    expect(findTariff(rules, 'reg', wib('2026-10-01', '10:00'), WIB).id).toBe('reg-day');
    expect(findTariff(rules, 'reg', wib('2026-10-01', '20:00'), WIB).id).toBe('reg-night');
    expect(findTariff(rules, 'reg', wib('2026-10-02', '03:00'), WIB).id).toBe('reg-night');
  });
  it('prioritas lebih tinggi menang', () => {
    expect(findTariff(rules, 'reg', wib('2026-10-03', '10:00'), WIB).id).toBe('reg-weekend');
  });
  it('melempar NoTariffError jika tidak ada tarif', () => {
    expect(() => findTariff(rules, 'vip', wib('2026-10-01', '10:00'), WIB)).toThrow(NoTariffError);
  });
});

describe('nextBoundary', () => {
  it('berhenti di batas tarif berikutnya', () => {
    expect(nextBoundary([day, night], 'reg', wib('2026-10-01', '17:30'), WIB)).toEqual(wib('2026-10-01', '18:00'));
  });
  it('berhenti di tengah malam lokal', () => {
    expect(nextBoundary([day, night], 'reg', wib('2026-10-01', '20:00'), WIB)).toEqual(wib('2026-10-02', '00:00'));
  });
});
