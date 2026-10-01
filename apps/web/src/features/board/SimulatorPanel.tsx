import { useMutation } from '@tanstack/react-query';
import { Cpu, Lightbulb, LightbulbOff, X } from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useBoard } from '../../stores/board';
import { showError } from '../../stores/toast';
import { useMe } from '../auth/auth';

type SimulateBody = { action: 'set'; channel: number; on: boolean } | { action: 'online'; online: boolean };

export function SimulatorPanel() {
  const me = useMe().data;
  const { devices, units } = useBoard(useShallow((s) => ({ devices: s.devices, units: s.units })));
  const [open, setOpen] = useState(false);
  const simulate = useMutation({
    mutationFn: ({ deviceId, body }: { deviceId: string; body: SimulateBody }) => api<void>('POST', `/devices/${deviceId}/simulate`, body),
    onError: showError,
  });

  const sims = Object.values(devices).filter((d) => d.driver === 'simulator');
  if (!me || me.role === 'KASIR' || sims.length === 0) return null;

  // relayChannel bernomor 1..N (sama dengan API/DB); state relay diindeks channel - 1
  const unitName = (deviceId: string, ch: number) =>
    Object.values(units).find((u) => u.deviceId === deviceId && u.relayChannel === ch)?.name ?? `Channel ${ch}`;

  if (!open) {
    return (
      <Button className="fixed bottom-4 right-4 z-30 shadow-lg" onClick={() => setOpen(true)}>
        <Cpu size={16} /> Simulator
      </Button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-30 w-80 rounded-2xl border border-line bg-surface p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold">Simulator relay</h3>
        <button type="button" aria-label="Tutup simulator" onClick={() => setOpen(false)}>
          <X size={18} />
        </button>
      </div>
      {sims.map((d) => (
        <div key={d.id} className="mb-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-semibold">{d.name}</span>
            <Button
              size="sm"
              variant={d.online ? 'soft' : 'danger'}
              onClick={() => simulate.mutate({ deviceId: d.id, body: { action: 'online', online: !d.online } })}
            >
              {d.online ? 'Online' : 'Offline'}
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: d.channels }, (_, i) => i + 1).map((ch) => {
              const on = d.relays?.[ch - 1] ?? false;
              return (
                <button
                  key={ch}
                  type="button"
                  aria-pressed={on}
                  aria-label={unitName(d.id, ch)}
                  disabled={!d.online}
                  onClick={() => simulate.mutate({ deviceId: d.id, body: { action: 'set', channel: ch, on: !on } })}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-xl p-2 text-[10px] font-semibold transition disabled:opacity-40',
                    on ? 'bg-amber-300 text-amber-950 shadow-[0_0_12px_rgba(251,191,36,.8)]' : 'bg-bg text-muted',
                  )}
                >
                  {on ? <Lightbulb size={18} /> : <LightbulbOff size={18} />}
                  <span className="truncate">{unitName(d.id, ch)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted">Menekan relay di sini meniru saklar fisik (untuk uji peringatan “menyala tanpa sesi”).</p>
    </div>
  );
}
