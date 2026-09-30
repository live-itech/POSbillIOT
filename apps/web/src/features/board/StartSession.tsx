import type { PackageDto, UnitView } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatMinutes, formatRupiah } from '../../lib/format';
import { toast } from '../../stores/toast';
import { useSessionAction } from './actions';

export function StartSession({ unit }: { unit: UnitView }) {
  const [mode, setMode] = useState<'OPEN' | 'PACKAGE'>('OPEN');
  const [packageId, setPackageId] = useState<string | null>(null);
  const packages = useQuery({ queryKey: ['/packages'], queryFn: () => api<PackageDto[]>('GET', '/packages') });
  const list = (packages.data ?? []).filter((p) => p.active && p.unitTypeId === unit.unitTypeId);
  const action = useSessionAction();

  const start = () =>
    action.mutate(
      { path: '/sessions', body: { unitId: unit.id, mode, ...(mode === 'PACKAGE' && packageId ? { packageId } : {}) } },
      { onSuccess: () => toast.success(`${unit.name} dimulai`) },
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-bg p-1">
        {(['OPEN', 'PACKAGE'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn('rounded-lg py-2 text-sm font-bold transition', mode === m ? 'bg-primary text-white' : 'text-primary-ink')}
          >
            {m === 'OPEN' ? 'Open billing' : 'Paket'}
          </button>
        ))}
      </div>
      {mode === 'PACKAGE' && (
        <div className="flex flex-col gap-2">
          {list.length === 0 && <p className="text-sm text-muted">Belum ada paket untuk tipe ini.</p>}
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPackageId(p.id)}
              className={cn(
                'flex justify-between rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition',
                packageId === p.id ? 'border-primary bg-primary-soft' : 'border-line',
              )}
            >
              <span>{p.name} · {formatMinutes(p.durationMin)}</span>
              <span>{formatRupiah(p.price)}</span>
            </button>
          ))}
        </div>
      )}
      <Button size="lg" onClick={start} disabled={action.isPending || (mode === 'PACKAGE' && !packageId)}>
        Mulai
      </Button>
    </div>
  );
}
