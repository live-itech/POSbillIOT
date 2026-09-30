import { outletLabels } from '@funplay/shared';
import { useNow } from '../../hooks/useNow';
import { useBoard } from '../../stores/board';
import { ActiveSession } from './ActiveSession';
import { StartSession } from './StartSession';
import { STATUS_STYLE, unitStatusOf } from './status';

export function UnitPanel() {
  const unit = useBoard((s) => (s.selectedUnitId ? (s.units[s.selectedUnitId] ?? null) : null));
  const settings = useBoard((s) => s.settings);
  const now = useNow();

  if (!unit || !settings) {
    const label = settings ? outletLabels(settings.outletType).unit.toLowerCase() : 'meja';
    return <aside className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-sm">Pilih {label} di sebelah kiri.</aside>;
  }
  const status = unitStatusOf(unit, now, settings.warnBeforeMin);

  return (
    <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-2xl bg-surface p-4 shadow-sm">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-extrabold">{unit.name}</h2>
          <p className="text-sm text-muted">{unit.unitTypeName}{unit.area && ` · ${unit.area}`}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${STATUS_STYLE[status].card}`}>{STATUS_STYLE[status].label}</span>
      </header>
      {status === 'MAINTENANCE' && <p className="rounded-xl bg-gray-100 p-3 text-sm text-gray-700">Sedang maintenance — tidak bisa dipakai.</p>}
      {status === 'IDLE' && <StartSession unit={unit} />}
      {unit.session && <ActiveSession unit={unit} session={unit.session} status={status} now={now} />}
    </aside>
  );
}
