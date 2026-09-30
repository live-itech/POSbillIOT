import { deriveUnitStatus, remainingMs, sessionElapsedMs, type UnitStatus, type UnitView } from '@funplay/shared';
import { formatDuration } from '../../lib/format';

export const STATUS_STYLE: Record<UnitStatus, { card: string; label: string }> = {
  IDLE: { card: 'bg-surface text-ink border-2 border-dashed border-violet-200 dark:border-violet-900', label: 'Kosong' },
  RUNNING: { card: 'bg-primary text-white shadow-lg shadow-violet-300/40 dark:shadow-none', label: 'Berjalan' },
  PAUSED: { card: 'bg-violet-300 text-violet-950', label: 'Pause' },
  WARNING: { card: 'bg-amber-400 text-amber-950 animate-pulse-soft', label: 'Hampir habis' },
  EXPIRED: { card: 'bg-rose-500 text-white', label: 'Habis' },
  MAINTENANCE: { card: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300', label: 'Maintenance' },
};

export function unitStatusOf(unit: UnitView, now: Date, warnBeforeMin: number): UnitStatus {
  return deriveUnitStatus({ maintenance: unit.state === 'MAINTENANCE', session: unit.session, now, warnBeforeMin });
}

export function timerText(unit: UnitView, status: UnitStatus, now: Date): string {
  const s = unit.session;
  if (!s) return status === 'MAINTENANCE' ? '—' : '00:00:00';
  if (status === 'EXPIRED') return 'Habis';
  if (s.mode === 'PACKAGE') return formatDuration(remainingMs(s, now) ?? 0);
  return formatDuration(sessionElapsedMs(s, now));
}
