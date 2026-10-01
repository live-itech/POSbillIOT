import { localHHMM, remainingMs, sessionElapsedMs, type SessionView, type UnitStatus, type UnitView } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { formatDuration } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { approvalPin } from '../../stores/pin';
import { useMe } from '../auth/auth';
import { useSessionAction } from './actions';
import { ChargeLines } from './ChargeLines';
import { ExtendDialog } from './ExtendDialog';
import { MoveDialog } from './MoveDialog';
import { StopDialog } from './StopDialog';
import { useChargePreview } from './useChargePreview';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function ActiveSession({ unit, session, status, now }: { unit: UnitView; session: SessionView; status: UnitStatus; now: Date }) {
  const me = useMe().data!;
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const charge = useChargePreview(session, now);
  const action = useSessionAction();
  const [dialog, setDialog] = useState<null | 'extend' | 'move' | 'stop'>(null);

  const pause = async () => {
    const pin = await approvalPin(me.role, 'PIN supervisor untuk pause');
    if (pin === null) return;
    action.mutate({ path: `/sessions/${session.id}/pause`, body: pin ? { approvalPin: pin } : {} });
  };
  const resume = () => action.mutate({ path: `/sessions/${session.id}/resume` });
  const left = remainingMs(session, now);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-xl bg-bg p-3">
        <Row label="Mulai" value={localHHMM(new Date(session.startedAt), offset)} />
        <Row label="Mode" value={session.mode === 'OPEN' ? 'Open billing' : (session.packageName ?? 'Paket')} />
        <Row label="Durasi main" value={formatDuration(sessionElapsedMs(session, now))} />
        {left !== null && <Row label="Sisa waktu" value={status === 'EXPIRED' ? 'Habis' : formatDuration(left)} />}
        <Row label="Lampu" value={unit.light === null ? 'Tidak diketahui' : unit.light ? 'Menyala' : 'Mati'} />
      </div>
      <ChargeLines charge={charge} />
      <div className="grid grid-cols-2 gap-2">
        {session.mode === 'PACKAGE' && (
          <Button variant="soft" onClick={() => setDialog('extend')}>+ Waktu</Button>
        )}
        <Button variant="soft" disabled={status === 'EXPIRED'} onClick={() => setDialog('move')}>Pindah</Button>
        {session.status === 'PAUSED' ? (
          <Button variant="warning" onClick={resume} disabled={action.isPending}>Lanjutkan</Button>
        ) : (
          <Button variant="warning" onClick={pause} disabled={action.isPending || session.status !== 'RUNNING'}>Pause</Button>
        )}
      </div>
      <Button variant="danger" size="lg" onClick={() => setDialog('stop')}>Stop</Button>

      <ExtendDialog sessionId={session.id} open={dialog === 'extend'} onClose={() => setDialog(null)} />
      <MoveDialog sessionId={session.id} fromUnitId={unit.id} open={dialog === 'move'} onClose={() => setDialog(null)} />
      <StopDialog unitName={unit.name} sessionId={session.id} preview={charge} open={dialog === 'stop'} onClose={() => setDialog(null)} />
    </div>
  );
}
