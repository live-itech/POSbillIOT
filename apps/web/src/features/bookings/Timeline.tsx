import { BOOKING_STATUS_LABEL, localHHMM, type BookingStatus, type BookingView } from '@funplay/shared';
import { useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { blockPosition, nowPosition } from './timeline';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const BLOCK_STYLE: Record<BookingStatus, string> = {
  BOOKED: 'bg-cyan-200 text-cyan-950',
  CHECKED_IN: 'bg-emerald-200 text-emerald-950',
  NO_SHOW: 'bg-rose-200 text-rose-950',
  CANCELLED: 'bg-gray-200 text-gray-500 line-through',
};

export function Timeline(props: {
  units: { id: string; name: string }[];
  bookings: BookingView[];
  dayStart: Date;
  now: Date;
  offset: number;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const nowPct = nowPosition(props.now, props.dayStart);
  const dayKey = props.dayStart.getTime();
  useEffect(() => {
    // Gulir otomatis ke jam sekarang hanya saat tanggal berganti (bukan setiap detik).
    const el = ref.current;
    const pct = nowPosition(new Date(), new Date(dayKey));
    if (el && pct !== null) el.scrollLeft = Math.max(0, (pct / 100) * el.scrollWidth - el.clientWidth / 2);
  }, [dayKey]);

  return (
    <div ref={ref} className="overflow-x-auto rounded-2xl bg-surface shadow-sm">
      <div className="min-w-[1560px]">
        <div className="grid grid-cols-[120px_1fr] border-b border-line text-xs text-muted">
          <div />
          <div className="relative h-6">
            {HOURS.map((h) => (
              <span key={h} className="absolute top-1 -translate-x-1/2" style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}</span>
            ))}
            {nowPct !== null && <div data-testid="timeline-now" className="absolute inset-y-0 w-0.5 bg-rose-500" style={{ left: `${nowPct}%` }} />}
          </div>
        </div>
        {props.units.map((u) => (
          <div key={u.id} data-testid={`timeline-row-${u.name}`} className="grid grid-cols-[120px_1fr] border-t border-line">
            <div className="px-3 py-3 text-sm font-semibold">{u.name}</div>
            <div className="relative h-12">
              {props.bookings
                .filter((b) => b.unitId === u.id)
                .map((b) => {
                  const pos = blockPosition(b.startAt, b.durationMin, props.dayStart);
                  if (!pos) return null;
                  const end = new Date(Date.parse(b.startAt) + b.durationMin * 60_000);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      title={`${b.customerName} · ${localHHMM(new Date(b.startAt), props.offset)}–${localHHMM(end, props.offset)} · ${BOOKING_STATUS_LABEL[b.status]}`}
                      onClick={() => props.onSelect(b.id)}
                      style={{ left: `${pos.leftPct}%`, width: `${pos.widthPct}%` }}
                      className={cn('absolute inset-y-1 overflow-hidden rounded-lg px-1 text-left text-xs font-semibold', BLOCK_STYLE[b.status])}
                    >
                      {b.customerName}
                    </button>
                  );
                })}
              {nowPct !== null && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-rose-500/60" style={{ left: `${nowPct}%` }} />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
