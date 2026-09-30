import { outletLabels } from '@funplay/shared';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNow } from '../../hooks/useNow';
import { cn } from '../../lib/cn';
import { useBoard } from '../../stores/board';
import { UnitCard } from './UnitCard';
import { UnitPanel } from './UnitPanel';

export function BoardPage() {
  const { order, units, settings, connected, selectedUnitId, select } = useBoard(
    useShallow((s) => ({ order: s.order, units: s.units, settings: s.settings, connected: s.connected, selectedUnitId: s.selectedUnitId, select: s.select })),
  );
  const now = useNow();
  const [filter, setFilter] = useState<string>('ALL');
  const types = useMemo(() => [...new Set(order.map((id) => units[id]!.unitTypeName))], [order, units]);
  const visible = order.filter((id) => filter === 'ALL' || units[id]!.unitTypeName === filter);

  if (!settings) return <div className="grid h-full place-items-center text-muted">Menghubungkan ke server…</div>;
  const labels = outletLabels(settings.outletType);

  return (
    <div className="flex h-full flex-col gap-3">
      {!connected && (
        <div role="alert" className="rounded-xl bg-rose-100 px-4 py-2 text-sm font-semibold text-rose-800">
          Koneksi ke server terputus — mencoba menyambung ulang…
        </div>
      )}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_380px]">
        <section className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {['ALL', ...types].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className={cn('rounded-full px-4 py-1.5 text-sm font-semibold transition', filter === t ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}
              >
                {t === 'ALL' ? `${labels.icon} Semua ${labels.unit}` : t}
              </button>
            ))}
          </div>
          <div className="grid min-h-0 grid-cols-2 content-start gap-3 overflow-y-auto pb-4 sm:grid-cols-3 xl:grid-cols-4">
            {visible.map((id) => (
              <UnitCard key={id} unit={units[id]!} now={now} selected={selectedUnitId === id} onSelect={() => select(id)} />
            ))}
          </div>
        </section>
        <UnitPanel />
      </div>
    </div>
  );
}
