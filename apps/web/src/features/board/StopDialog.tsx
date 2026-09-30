import type { TimeCharge, UnitView } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { showError, toast } from '../../stores/toast';
import { ChargeLines } from './ChargeLines';

export function StopDialog(props: { unitName: string; sessionId: string; preview: TimeCharge | null; open: boolean; onClose: () => void }) {
  const stop = useMutation({
    mutationFn: () => api<{ unit: UnitView; charge: TimeCharge }>('POST', `/sessions/${props.sessionId}/stop`, {}),
    onSuccess: (r) => {
      useBoard.getState().applyUnit(r.unit);
      toast.success(`${props.unitName} selesai. Total waktu ${formatRupiah(r.charge.total)}`);
      props.onClose();
    },
    onError: showError,
  });

  return (
    <Modal
      open={props.open}
      onOpenChange={(o) => !o && props.onClose()}
      title={`Stop ${props.unitName}?`}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>Batal</Button>
          <Button variant="danger" onClick={() => stop.mutate()} disabled={stop.isPending}>Ya, stop</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">Lampu akan dimatikan dan meja kembali kosong.</p>
      <ChargeLines charge={props.preview} />
    </Modal>
  );
}
