export interface SegmentInput {
  unitTypeId: string;
  startedAt: Date;
  endedAt: Date | null;
}

export interface PauseInput {
  pausedAt: Date;
  resumedAt: Date | null;
}

export interface BillableInterval {
  unitTypeId: string;
  start: Date;
  end: Date;
}

/** Waktu main yang ditagih: tiap segmen meja dikurangi rentang pause, dipotong di `until`. */
export function buildBillableIntervals(segments: SegmentInput[], pauses: PauseInput[], until: Date): BillableInterval[] {
  const untilMs = until.getTime();
  const pauseRanges = pauses
    .map((p) => [p.pausedAt.getTime(), (p.resumedAt ?? until).getTime()] as const)
    .sort((a, b) => a[0] - b[0]);
  const sorted = [...segments].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const out: BillableInterval[] = [];

  for (const seg of sorted) {
    const segEnd = Math.min((seg.endedAt ?? until).getTime(), untilMs);
    let cursor = seg.startedAt.getTime();
    for (const [ps, pe] of pauseRanges) {
      if (pe <= cursor || ps >= segEnd) continue;
      if (ps > cursor) out.push({ unitTypeId: seg.unitTypeId, start: new Date(cursor), end: new Date(ps) });
      cursor = Math.max(cursor, pe);
    }
    if (segEnd > cursor) out.push({ unitTypeId: seg.unitTypeId, start: new Date(cursor), end: new Date(segEnd) });
  }
  return out;
}

export function totalMs(intervals: BillableInterval[]): number {
  return intervals.reduce((sum, iv) => sum + (iv.end.getTime() - iv.start.getTime()), 0);
}

/** Membuang `ms` pertama dari waktu tertagih (dipakai untuk memotong durasi paket). */
export function dropLeadingMs(intervals: BillableInterval[], ms: number): BillableInterval[] {
  let left = ms;
  const out: BillableInterval[] = [];
  for (const iv of intervals) {
    const len = iv.end.getTime() - iv.start.getTime();
    if (left >= len) {
      left -= len;
      continue;
    }
    out.push(left > 0 ? { ...iv, start: new Date(iv.start.getTime() + left) } : iv);
    left = 0;
  }
  return out;
}
