import { localHHMM, type UnitView } from '@funplay/shared';
import { Lightbulb, LightbulbOff, WifiOff } from 'lucide-react';
import { cn } from '../../lib/cn';
import { formatRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { STATUS_STYLE, timerText, unitStatusOf } from './status';
import { useChargePreview } from './useChargePreview';

function LightBadge({ light, online }: { light: boolean | null; online: boolean | null }) {
  if (online === null) return null;
  if (!online) {
    return (
      <span aria-label="Device offline" title="Device offline" className="grid h-7 w-7 place-items-center rounded-full bg-rose-600 text-white">
        <WifiOff size={14} />
      </span>
    );
  }
  return (
    <span aria-label={light ? 'Lampu menyala' : 'Lampu mati'} className="grid h-7 w-7 place-items-center rounded-full bg-black/10">
      {light ? <Lightbulb size={14} /> : <LightbulbOff size={14} />}
    </span>
  );
}

export function UnitCard({ unit, now, selected, onSelect }: { unit: UnitView; now: Date; selected: boolean; onSelect: () => void }) {
  const warnBeforeMin = useBoard((s) => s.settings?.warnBeforeMin ?? 5);
  const status = unitStatusOf(unit, now, warnBeforeMin);
  const charge = useChargePreview(unit.session, now);
  const style = STATUS_STYLE[status];
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const booked = !unit.session && unit.state === 'ACTIVE' ? unit.booking : null;
  const bookedText = booked
    ? `Booked · ${booked.customerName} ${localHHMM(new Date(booked.startAt), offset)}${booked.depositPaid ? ' 💰' : ''}`
    : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      data-testid={`unit-card-${unit.name}`}
      data-status={status}
      data-booked={booked ? 'true' : undefined}
      data-light={unit.light === null ? 'unknown' : unit.light ? 'on' : 'off'}
      className={cn(
        'flex min-h-32 flex-col justify-between rounded-2xl p-3 text-left transition active:scale-[.98]',
        booked ? 'border-2 border-cyan-300 bg-[#CFFAFE] text-cyan-950' : style.card,
        selected && 'ring-4 ring-accent ring-offset-2 ring-offset-bg',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-bold leading-tight">{unit.name}</div>
          <div className="text-xs opacity-80">
            {unit.unitTypeName}
            {unit.area && ` · ${unit.area}`}
          </div>
        </div>
        <LightBadge light={unit.light} online={unit.deviceOnline} />
      </div>
      <div className="text-2xl font-extrabold tabular-nums">{timerText(unit, status, now)}</div>
      <div className="flex items-center justify-between text-xs font-semibold opacity-90">
        <span>{bookedText ?? style.label}</span>
        {charge && <span className="tabular-nums">{formatRupiah(charge.total)}</span>}
      </div>
    </button>
  );
}
