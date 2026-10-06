import { outletLabels } from '@funplay/shared';
import { Illustration } from '../../components/brand/Brand';
import { useNow } from '../../hooks/useNow';
import { useBoard } from '../../stores/board';
import { ActiveSession } from './ActiveSession';
import { LightControl } from './LightControl';
import { BookedPanel } from './BookedPanel';
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
      {unit.deviceOnline === false && (
        <div role="status" className="flex items-center gap-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          <Illustration name="empty-device-offline" className="w-20 shrink-0" />
          <p>Device lampu offline. Sesi tetap berjalan; lampu akan menyesuaikan otomatis saat device tersambung lagi.</p>
        </div>
      )}
      {status === 'MAINTENANCE' && <p className="rounded-xl bg-gray-100 p-3 text-sm text-gray-700">Sedang maintenance — tidak bisa dipakai.</p>}
      {status === 'IDLE' &&
        (unit.booking ? <BookedPanel key={unit.id} unit={unit} booking={unit.booking} /> : <StartSession key={unit.id} unit={unit} />)}
      {unit.session && <ActiveSession key={unit.id} unit={unit} session={unit.session} status={status} now={now} />}
      <LightControl key={`light-${unit.id}`} unit={unit} />
    </aside>
  );
}
