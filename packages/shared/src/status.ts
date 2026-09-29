import type { SessionStatus } from './constants';
import type { Instant } from './billing/session-charge';
import { MS_PER_MIN } from './time';

export type UnitStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'WARNING' | 'EXPIRED' | 'MAINTENANCE';

export interface StatusSessionLike {
  status: SessionStatus;
  plannedEndAt: Instant | null;
  pauses?: { pausedAt: Instant; resumedAt: Instant | null }[];
}

/** Sisa waktu paket; dibekukan pada awal pause yang sedang berjalan. null untuk open billing. */
export function remainingMs(s: StatusSessionLike, now: Date): number | null {
  if (!s.plannedEndAt) return null;
  const end = new Date(s.plannedEndAt).getTime();
  const openPause = s.status === 'PAUSED' ? s.pauses?.find((p) => p.resumedAt === null) : undefined;
  const ref = openPause ? new Date(openPause.pausedAt).getTime() : now.getTime();
  return Math.max(0, end - ref);
}

export function deriveUnitStatus(input: { maintenance: boolean; session: StatusSessionLike | null; now: Date; warnBeforeMin: number }): UnitStatus {
  const { maintenance, session, now, warnBeforeMin } = input;
  if (!session || session.status === 'ENDED') return maintenance ? 'MAINTENANCE' : 'IDLE';
  if (session.status === 'EXPIRED') return 'EXPIRED';
  if (session.status === 'PAUSED') return 'PAUSED';
  const left = remainingMs(session, now);
  if (left === null) return 'RUNNING';
  if (left <= 0) return 'EXPIRED';
  if (left <= warnBeforeMin * MS_PER_MIN) return 'WARNING';
  return 'RUNNING';
}
