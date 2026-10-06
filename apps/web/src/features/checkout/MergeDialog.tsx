import type { BillSummary } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../../components/ui/modal';
import { useBillAction } from '../../hooks/useBill';
import { api } from '../../lib/api';
import { formatRupiah } from '../../lib/format';

export function MergeDialog({ targetId, onClose }: { targetId: string; onClose: () => void }) {
  const open = useQuery({ queryKey: ['bills', { status: 'OPEN' }], queryFn: () => api<BillSummary[]>('GET', '/bills?status=OPEN') });
  const action = useBillAction(targetId);
  const others = (open.data ?? []).filter((b) => b.id !== targetId && b.kind !== 'DEPOSIT');
  const merge = async (sourceBillId: string) => {
    try {
      await action.mutateAsync({ method: 'POST', path: `/bills/${targetId}/merge`, body: { sourceBillId } });
      onClose();
    } catch {
      // ditampilkan oleh hook
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Gabung bill lain">
      {others.length === 0 && <p className="text-sm text-muted">Tidak ada bill lain yang belum dibayar.</p>}
      <div className="flex flex-col gap-2">
        {others.map((b) => (
          <button key={b.id} type="button" disabled={action.isPending} onClick={() => merge(b.id)}
            className="flex justify-between rounded-xl border-2 border-line px-3 py-2 text-left text-sm font-semibold hover:border-primary">
            <span>{b.label} · {b.number}{b.hasActiveSession ? ' · masih main' : ''}</span>
            <span className="tabular-nums">{formatRupiah(b.total)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
