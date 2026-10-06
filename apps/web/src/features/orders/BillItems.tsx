import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useBill, useBillAction, useBillPreview } from '../../hooks/useBill';
import { useNow } from '../../hooks/useNow';
import { useHasShift } from '../../hooks/useShift';
import { formatRupiah } from '../../lib/format';
import { approvalPin } from '../../stores/pin';
import { useMe } from '../auth/auth';
import { OrderDialog } from './OrderDialog';

export function BillItems({ billId }: { billId: string }) {
  const me = useMe().data;
  const bill = useBill(billId);
  const now = useNow();
  const preview = useBillPreview(bill.data, now);
  const action = useBillAction(billId);
  const hasShift = useHasShift();
  const [ordering, setOrdering] = useState(false);
  if (!bill.data || !me) return null;
  const items = bill.data.lines.filter((l) => l.type !== 'TIME');
  const path = (lineId: string) => `/bills/${billId}/items/${lineId}`;

  const decrease = async (lineId: string, name: string, qty: number) => {
    const pin = await approvalPin(me.role, `PIN supervisor untuk mengurangi ${name}`);
    if (pin === null) return;
    action.mutate({ method: 'PATCH', path: path(lineId), body: { qty: qty - 1, ...(pin ? { approvalPin: pin } : {}) } });
  };
  const remove = async (lineId: string, name: string) => {
    const pin = await approvalPin(me.role, `PIN supervisor untuk menghapus ${name}`);
    if (pin === null) return;
    action.mutate({ method: 'DELETE', path: path(lineId), body: pin ? { approvalPin: pin } : {} });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-bg p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-bold">Pesanan</span>
        <Button size="sm" variant="soft" disabled={!hasShift} onClick={() => setOrdering(true)}>+ Pesan</Button>
      </div>
      {items.length === 0 && <p className="text-muted">Belum ada pesanan.</p>}
      {items.map((l) => (
        <div key={l.id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{l.name}</span>
          <button type="button" aria-label={`Kurangi ${l.name}`} disabled={!hasShift || l.qty <= 1 || action.isPending} onClick={() => decrease(l.id, l.name, l.qty)} className="disabled:opacity-30"><Minus size={14} /></button>
          <span className="w-6 text-center tabular-nums">{l.qty}</span>
          <button type="button" aria-label={`Tambah ${l.name}`} disabled={!hasShift || action.isPending} onClick={() => action.mutate({ method: 'PATCH', path: path(l.id), body: { qty: l.qty + 1 } })}><Plus size={14} /></button>
          <span className="w-20 text-right tabular-nums">{formatRupiah(l.unitPrice * l.qty)}</span>
          <button type="button" aria-label={`Hapus ${l.name}`} disabled={!hasShift || action.isPending} onClick={() => remove(l.id, l.name)} className="text-rose-600"><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="flex justify-between border-t border-line pt-2 font-extrabold text-primary">
        <span>Total sementara</span>
        <span className="tabular-nums" data-testid="bill-running-total">{formatRupiah(preview?.totals.grandTotal ?? 0)}</span>
      </div>
      <OrderDialog billId={billId} title={`Pesan · ${bill.data.label}`} open={ordering} onClose={() => setOrdering(false)} />
    </div>
  );
}
