import { MS_PER_MIN } from '../time';
import { dropLeadingMs, totalMs, type BillableInterval } from './intervals';
import { findTariff, nextBoundary, type TariffRule } from './tariff';

export interface RoundingRule {
  blockMin: number;
  minChargeMin: number;
}

export interface PackageInfo {
  name: string;
  durationMin: number;
  price: number;
}

export interface ChargeLine {
  kind: 'PACKAGE' | 'TARIFF';
  label: string;
  tariffId: string | null;
  unitTypeId: string | null;
  pricePerHour: number | null;
  minutes: number;
  amount: number;
}

export interface TimeCharge {
  billableMinutes: number;
  chargedMinutes: number;
  total: number;
  lines: ChargeLine[];
}

export interface ComputeTimeChargeInput {
  intervals: BillableInterval[];
  anchor: { unitTypeId: string; at: Date };
  tariffs: TariffRule[];
  rounding: RoundingRule;
  utcOffsetMin: number;
  pkg?: PackageInfo | null;
}

const EPS = 1e-9;

function ceilMinutes(ms: number): number {
  return Math.max(0, Math.ceil(ms / MS_PER_MIN - EPS));
}

export function roundUpMinutes(rawMs: number, rule: RoundingRule, applyMinimum: boolean): number {
  const block = Math.max(1, rule.blockMin);
  let rounded = Math.ceil(ceilMinutes(rawMs) / block) * block;
  if (applyMinimum) rounded = Math.max(rounded, rule.minChargeMin);
  return rounded;
}

interface Piece {
  rule: TariffRule;
  ms: number;
}

function splitByTariff(intervals: BillableInterval[], tariffs: TariffRule[], utcOffsetMin: number): Piece[] {
  const pieces: Piece[] = [];
  for (const iv of intervals) {
    let cursor = iv.start;
    while (cursor.getTime() < iv.end.getTime()) {
      const rule = findTariff(tariffs, iv.unitTypeId, cursor, utcOffsetMin);
      const boundary = nextBoundary(tariffs, iv.unitTypeId, cursor, utcOffsetMin);
      const end = boundary.getTime() < iv.end.getTime() ? boundary : iv.end;
      const ms = end.getTime() - cursor.getTime();
      const last = pieces[pieces.length - 1];
      if (last && last.rule.id === rule.id) last.ms += ms;
      else pieces.push({ rule, ms });
      cursor = end;
    }
  }
  return pieces;
}

export function computeTimeCharge(input: ComputeTimeChargeInput): TimeCharge {
  const { intervals, anchor, tariffs, rounding, utcOffsetMin, pkg } = input;
  const lines: ChargeLine[] = [];
  let chargedMinutes = 0;
  let tariffIntervals = intervals;

  if (pkg) {
    lines.push({ kind: 'PACKAGE', label: pkg.name, tariffId: null, unitTypeId: null, pricePerHour: null, minutes: pkg.durationMin, amount: pkg.price });
    chargedMinutes += pkg.durationMin;
    tariffIntervals = dropLeadingMs(intervals, pkg.durationMin * MS_PER_MIN);
  }

  const restMs = totalMs(tariffIntervals);
  const restCharged = pkg && restMs === 0 ? 0 : roundUpMinutes(restMs, rounding, !pkg);

  if (restCharged > 0) {
    const pieces = splitByTariff(tariffIntervals, tariffs, utcOffsetMin);
    if (pieces.length === 0) pieces.push({ rule: findTariff(tariffs, anchor.unitTypeId, anchor.at, utcOffsetMin), ms: 0 });
    pieces[pieces.length - 1]!.ms += restCharged * MS_PER_MIN - restMs;

    let cum = 0;
    let prevRounded = 0;
    for (const p of pieces) {
      cum += p.ms;
      const rounded = Math.round(cum / MS_PER_MIN);
      const minutes = rounded - prevRounded;
      prevRounded = rounded;
      if (minutes <= 0) continue;
      lines.push({
        kind: 'TARIFF',
        label: p.rule.name,
        tariffId: p.rule.id,
        unitTypeId: p.rule.unitTypeId,
        pricePerHour: p.rule.pricePerHour,
        minutes,
        amount: Math.round((p.rule.pricePerHour * minutes) / 60),
      });
    }
    chargedMinutes += restCharged;
  }

  return {
    billableMinutes: ceilMinutes(totalMs(intervals)),
    chargedMinutes,
    total: lines.reduce((s, l) => s + l.amount, 0),
    lines,
  };
}
