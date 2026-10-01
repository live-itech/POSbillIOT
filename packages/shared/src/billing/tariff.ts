import { localDayStart, localParts, MINUTES_PER_DAY, MS_PER_MIN } from '../time';

export interface TariffRule {
  id: string;
  unitTypeId: string;
  name: string;
  daysMask: number;
  startMin: number;
  endMin: number;
  pricePerHour: number;
  priority: number;
}

export const ALL_DAYS = 0b1111111;

export function dayBit(dow: number): number {
  return 1 << dow;
}

export function daysToMask(days: number[]): number {
  return days.reduce((mask, d) => mask | dayBit(d), 0);
}

export function maskToDays(mask: number): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => (mask & dayBit(d)) !== 0);
}

export class NoTariffError extends Error {
  constructor(
    public readonly unitTypeId: string,
    public readonly at: Date,
  ) {
    super(`Tidak ada tarif untuk tipe ${unitTypeId} pada ${at.toISOString()}`);
    this.name = 'NoTariffError';
  }
}

export function ruleCovers(rule: TariffRule, dow: number, minuteOfDay: number): boolean {
  const has = (d: number) => (rule.daysMask & dayBit(d)) !== 0;
  if (rule.endMin > rule.startMin) {
    return has(dow) && minuteOfDay >= rule.startMin && minuteOfDay < rule.endMin;
  }
  if (has(dow) && minuteOfDay >= rule.startMin) return true;
  return has((dow + 6) % 7) && minuteOfDay < rule.endMin;
}

/** Tarif yang berlaku pada `at`, atau null bila tidak ada aturan yang mencakup menit tersebut. */
export function coveringTariff(rules: TariffRule[], unitTypeId: string, at: Date, utcOffsetMin: number): TariffRule | null {
  const { dow, minuteOfDay } = localParts(at, utcOffsetMin);
  let best: TariffRule | null = null;
  for (const r of rules) {
    if (r.unitTypeId !== unitTypeId || !ruleCovers(r, dow, minuteOfDay)) continue;
    if (!best || r.priority > best.priority) best = r;
  }
  return best;
}

export function findTariff(rules: TariffRule[], unitTypeId: string, at: Date, utcOffsetMin: number): TariffRule {
  const best = coveringTariff(rules, unitTypeId, at, utcOffsetMin);
  if (!best) throw new NoTariffError(unitTypeId, at);
  return best;
}

const SCAN_LIMIT_MIN = 8 * MINUTES_PER_DAY;

/**
 * Tarif terdekat untuk menit yang tidak tercakup aturan mana pun: tarif yang berlaku paling akhir
 * sebelum `at`, atau bila tidak ada, yang paling awal sesudahnya. Melempar NoTariffError hanya jika
 * tipe meja sama sekali tidak punya tarif yang pernah berlaku.
 */
export function nearestTariff(rules: TariffRule[], unitTypeId: string, at: Date, utcOffsetMin: number): TariffRule {
  const covering = coveringTariff(rules, unitTypeId, at, utcOffsetMin);
  if (covering) return covering;
  if (rules.some((r) => r.unitTypeId === unitTypeId)) {
    for (const dir of [-1, 1]) {
      for (let k = 1; k <= SCAN_LIMIT_MIN; k++) {
        const r = coveringTariff(rules, unitTypeId, new Date(at.getTime() + dir * k * MS_PER_MIN), utcOffsetMin);
        if (r) return r;
      }
    }
  }
  throw new NoTariffError(unitTypeId, at);
}

/** Instan berikutnya setelah `at` di mana tarif yang berlaku bisa berubah (batas aturan atau tengah malam lokal). */
export function nextBoundary(rules: TariffRule[], unitTypeId: string, at: Date, utcOffsetMin: number): Date {
  const { minuteOfDay } = localParts(at, utcOffsetMin);
  const points = new Set<number>([MINUTES_PER_DAY]);
  for (const r of rules) {
    if (r.unitTypeId !== unitTypeId) continue;
    points.add(r.startMin);
    points.add(r.endMin % MINUTES_PER_DAY || MINUTES_PER_DAY);
  }
  let next = MINUTES_PER_DAY;
  for (const p of points) if (p > minuteOfDay && p < next) next = p;
  return new Date(localDayStart(at, utcOffsetMin).getTime() + next * MS_PER_MIN);
}
