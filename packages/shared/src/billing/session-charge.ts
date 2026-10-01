import type { SessionMode } from '../constants';
import { computeTimeCharge, type TimeCharge } from './charge';
import { buildBillableIntervals, totalMs, type BillableInterval } from './intervals';
import type { TariffRule } from './tariff';

export type Instant = Date | string;

export interface SessionLike {
  mode: SessionMode;
  startedAt: Instant;
  endedAt: Instant | null;
  packageName: string | null;
  packageDurationMin: number | null;
  packagePrice: number | null;
  segments: { unitTypeId: string; startedAt: Instant; endedAt: Instant | null }[];
  pauses: { pausedAt: Instant; resumedAt: Instant | null }[];
}

export interface ChargeSettings {
  utcOffsetMin: number;
  roundingBlockMin: number;
  minChargeMin: number;
}

const toDate = (v: Instant): Date => (v instanceof Date ? v : new Date(v));

function intervalsOf(s: SessionLike, now: Date): BillableInterval[] {
  const until = s.endedAt ? toDate(s.endedAt) : now;
  return buildBillableIntervals(
    s.segments.map((g) => ({ unitTypeId: g.unitTypeId, startedAt: toDate(g.startedAt), endedAt: g.endedAt ? toDate(g.endedAt) : null })),
    s.pauses.map((p) => ({ pausedAt: toDate(p.pausedAt), resumedAt: p.resumedAt ? toDate(p.resumedAt) : null })),
    until,
  );
}

export function sessionElapsedMs(s: SessionLike, now: Date): number {
  return totalMs(intervalsOf(s, now));
}

export function computeSessionCharge(s: SessionLike, tariffs: TariffRule[], settings: ChargeSettings, now: Date): TimeCharge {
  const first = s.segments[0];
  if (!first) throw new Error('Sesi tanpa segmen');
  const pkg =
    s.mode === 'PACKAGE' && s.packageDurationMin != null && s.packagePrice != null
      ? { name: s.packageName ?? 'Paket', durationMin: s.packageDurationMin, price: s.packagePrice }
      : null;
  return computeTimeCharge({
    intervals: intervalsOf(s, now),
    anchor: { unitTypeId: first.unitTypeId, at: toDate(s.startedAt) },
    tariffs,
    rounding: { blockMin: settings.roundingBlockMin, minChargeMin: settings.minChargeMin },
    utcOffsetMin: settings.utcOffsetMin,
    pkg,
  });
}
