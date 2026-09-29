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

export function findTariff(rules: TariffRule[], unitTypeId: string, at: Date, utcOffsetMin: number): TariffRule {
  const { dow, minuteOfDay } = localParts(at, utcOffsetMin);
  let best: TariffRule | undefined;
  for (const r of rules) {
    if (r.unitTypeId !== unitTypeId || !ruleCovers(r, dow, minuteOfDay)) continue;
    if (!best || r.priority > best.priority) best = r;
  }
  if (!best) throw new NoTariffError(unitTypeId, at);
  return best;
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
