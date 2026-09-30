import { useShallow } from 'zustand/react/shallow';
import { Modal } from '../../components/ui/modal';
import { useBoard } from '../../stores/board';
import { toast } from '../../stores/toast';
import { useSessionAction } from './actions';

export function MoveDialog({ sessionId, fromUnitId, open, onClose }: { sessionId: string; fromUnitId: string; open: boolean; onClose: () => void }) {
  const { order, units } = useBoard(useShallow((s) => ({ order: s.order, units: s.units })));
  const targets = order.map((id) => units[id]!).filter((u) => u.id !== fromUnitId && u.state === 'ACTIVE' && !u.session);
  const action = useSessionAction();

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="Pindah ke meja">
      {targets.length === 0 && <p className="text-sm text-muted">Tidak ada meja kosong.</p>}
      <div className="grid grid-cols-2 gap-2">
        {targets.map((u) => (
          <button
            key={u.id}
            type="button"
            disabled={action.isPending}
            onClick={async () => {
              try {
                await action.mutateAsync({ path: `/sessions/${sessionId}/move`, body: { toUnitId: u.id } });
                toast.success(`Dipindah ke ${u.name}`);
                onClose();
              } catch {
                // error sudah ditampilkan oleh hook (showError)
              }
            }}
            className="rounded-xl border-2 border-line p-3 text-left font-semibold hover:border-primary"
          >
            {u.name}
            <div className="text-xs font-normal text-muted">{u.unitTypeName}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
