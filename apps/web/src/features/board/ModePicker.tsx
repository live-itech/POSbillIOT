import type { PackageDto } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatMinutes, formatRupiah } from '../../lib/format';

export type StartMode = 'OPEN' | 'PACKAGE';

/** Pilihan Open billing / Paket (paket aktif untuk tipe meja). Dipakai Mulai sesi dan Check-in. */
export function ModePicker(props: {
  unitTypeId: string;
  mode: StartMode;
  onMode: (m: StartMode) => void;
  packageId: string | null;
  onPackage: (id: string) => void;
}) {
  const packages = useQuery({ queryKey: ['/packages'], queryFn: () => api<PackageDto[]>('GET', '/packages') });
  const list = (packages.data ?? []).filter((p) => p.active && p.unitTypeId === props.unitTypeId);
  return (
    <>
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-bg p-1">
        {(['OPEN', 'PACKAGE'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => props.onMode(m)}
            className={cn('rounded-lg py-2 text-sm font-bold transition', props.mode === m ? 'bg-primary text-white' : 'text-primary-ink')}
          >
            {m === 'OPEN' ? 'Open billing' : 'Paket'}
          </button>
        ))}
      </div>
      {props.mode === 'PACKAGE' && (
        <div className="flex flex-col gap-2">
          {list.length === 0 && <p className="text-sm text-muted">Belum ada paket untuk tipe ini.</p>}
          {list.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => props.onPackage(p.id)}
              className={cn(
                'flex justify-between rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition',
                props.packageId === p.id ? 'border-primary bg-primary-soft' : 'border-line',
              )}
            >
              <span>{p.name} · {formatMinutes(p.durationMin)}</span>
              <span>{formatRupiah(p.price)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
