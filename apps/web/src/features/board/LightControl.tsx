import type { UnitView } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { approvalPin } from '../../stores/pin';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';

type Mode = 'ON' | 'OFF' | 'AUTO';
const TITLE: Record<Mode, string> = { ON: 'Nyalakan manual', OFF: 'Matikan manual', AUTO: 'Kembali otomatis' };

export function LightControl({ unit }: { unit: UnitView }) {
  const me = useMe().data;
  const [mode, setMode] = useState<Mode | null>(null);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: (vars: { mode: Mode; reason: string; approvalPin?: string }) =>
      api<{ unit: UnitView }>('POST', `/units/${unit.id}/light`, vars),
    onSuccess: (r) => useBoard.getState().applyActionUnit(r.unit),
    onError: showError,
  });

  if (!unit.deviceId || !me) return null;

  const submit = async () => {
    if (!mode) return;
    const pin = await approvalPin(me.role, 'PIN supervisor untuk kontrol lampu');
    if (pin === null) return;
    try {
      await m.mutateAsync({ mode, reason: reason.trim(), approvalPin: pin });
      toast.success('Kontrol lampu diperbarui');
      setMode(null);
      setReason('');
    } catch {
      // error sudah ditampilkan oleh hook (showError)
    }
  };

  return (
    <section className="border-t border-line pt-3">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-bold">Lampu</span>
        {unit.lightOverride !== null && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">Manual</span>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(['ON', 'OFF', 'AUTO'] as const).map((md) => (
          <Button key={md} size="sm" variant="soft" onClick={() => setMode(md)} disabled={md === 'AUTO' && unit.lightOverride === null}>
            {TITLE[md]}
          </Button>
        ))}
      </div>
      <Modal
        open={mode !== null}
        onOpenChange={(o) => !o && setMode(null)}
        title={mode ? `${TITLE[mode]} — ${unit.name}` : ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>Batal</Button>
            <Button onClick={submit} disabled={reason.trim().length < 3 || m.isPending}>Simpan</Button>
          </>
        }
      >
        <label className="text-sm font-semibold">
          Alasan
          <Input className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="mis. bersih-bersih meja" />
        </label>
        <p className="mt-2 text-xs text-muted">Tercatat di log audit.</p>
      </Modal>
    </section>
  );
}
