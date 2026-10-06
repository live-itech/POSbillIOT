const DAY_MIN = 1440;
const MS_PER_MIN = 60_000;

/** Posisi blok booking (persen lebar timeline 24 jam), dipotong di batas hari; null bila di luar hari. */
export function blockPosition(startAt: string, durationMin: number, dayStart: Date): { leftPct: number; widthPct: number } | null {
  const startMin = (Date.parse(startAt) - dayStart.getTime()) / MS_PER_MIN;
  const endMin = Math.min(startMin + durationMin, DAY_MIN);
  const from = Math.max(0, startMin);
  if (endMin <= 0 || from >= DAY_MIN) return null;
  return { leftPct: (from / DAY_MIN) * 100, widthPct: ((endMin - from) / DAY_MIN) * 100 };
}

/** Posisi garis "sekarang" (persen), atau null bila `now` di luar hari yang ditampilkan. */
export function nowPosition(now: Date, dayStart: Date): number | null {
  const min = (now.getTime() - dayStart.getTime()) / MS_PER_MIN;
  return min >= 0 && min < DAY_MIN ? (min / DAY_MIN) * 100 : null;
}
