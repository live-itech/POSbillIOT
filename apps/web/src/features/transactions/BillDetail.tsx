import { BILL_STATUS_LABEL, formatReceiptDate, PAYMENT_METHOD_LABEL } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useBill, useBillAction, useBillPreview } from '../../hooks/useBill';
import { useNow } from '../../hooks/useNow';
import { api } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { approvalPin } from '../../stores/pin';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';
import { OrderDialog } from '../orders/OrderDialog';

function ReasonDialog({ title, onSubmit, onClose }: { title: string; onSubmit: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim()) onSubmit(reason.trim());
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} width="max-w-sm">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="text-sm font-semibold">Alasan<Input className="mt-1" autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={!reason.trim()}>Lanjut</Button>
        </div>
      </form>
    </Modal>
  );
}

export function BillDetail({ billId }: { billId: string }) {
  const me = useMe().data;
  const bill = useBill(billId);
  const now = useNow();
  const preview = useBillPreview(bill.data, now);
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const action = useBillAction(billId);
  const openCheckout = useCheckout((s) => s.open);
  const [asking, setAsking] = useState<null | 'void' | 'cancel'>(null);
  const [ordering, setOrdering] = useState(false);
  const reprint = useMutation({ mutationFn: () => api('POST', `/bills/${billId}/print`, {}), onSuccess: () => toast.success('Struk dikirim ke printer'), onError: showError });

  if (!bill.data || !me) return <div className="text-sm text-muted">Memuat…</div>;
  const b = bill.data;
  const totals = b.stored ?? (preview ? { ...preview.totals } : null);
  const when = (iso: string | null) => (iso ? formatReceiptDate(new Date(iso), offset) : '—');

  const confirmReason = async (reason: string) => {
    const kind = asking;
    setAsking(null);
    if (kind === 'void') {
      const pin = await approvalPin(me.role, 'PIN supervisor untuk void');
      if (pin === null) return;
      action.mutate({ method: 'POST', path: `/bills/${billId}/void`, body: { reason, ...(pin ? { approvalPin: pin } : {}) } });
    } else if (kind === 'cancel') {
      const needsPin = (preview?.totals.grandTotal ?? 0) > 0;
      const pin = needsPin ? await approvalPin(me.role, 'PIN supervisor untuk membatalkan bill') : undefined;
      if (pin === null) return;
      action.mutate({ method: 'POST', path: `/bills/${billId}/cancel`, body: { reason, ...(pin ? { approvalPin: pin } : {}) } });
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-extrabold">{b.label}</h2>
          <p className="text-xs text-muted">{b.number} · dibuat {when(b.createdAt)} oleh {b.createdByName}</p>
          {b.paidAt && <p className="text-xs text-muted">Dibayar {when(b.paidAt)} oleh {b.paidByName}</p>}
        </div>
        <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary-ink">{BILL_STATUS_LABEL[b.status]}</span>
      </header>
      <div className="flex flex-col gap-1 text-sm">
        {b.lines.map((l) => (
          <div key={l.id} className="flex justify-between">
            <span>{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</span>
            <span className="tabular-nums">{formatRupiah(l.unitPrice * l.qty)}</span>
          </div>
        ))}
        {b.activeSessions.map((s) => <p key={s.id} className="text-amber-700">{s.unitName} masih berjalan</p>)}
      </div>
      {totals && (
        <div className="flex flex-col gap-1 border-t border-line pt-2 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatRupiah(totals.subtotal)}</span></div>
          {totals.discountTotal > 0 && <div className="flex justify-between"><span>Diskon</span><span className="tabular-nums">-{formatRupiah(totals.discountTotal)}</span></div>}
          {totals.serviceTotal > 0 && <div className="flex justify-between"><span>Service</span><span className="tabular-nums">{formatRupiah(totals.serviceTotal)}</span></div>}
          {totals.taxTotal > 0 && <div className="flex justify-between"><span>Pajak</span><span className="tabular-nums">{formatRupiah(totals.taxTotal)}</span></div>}
          <div className="flex justify-between text-base font-extrabold text-primary"><span>Total</span><span className="tabular-nums">{formatRupiah(totals.grandTotal)}</span></div>
        </div>
      )}
      {b.payments.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl bg-bg p-2 text-sm">
          {b.payments.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>{PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
              <span className="tabular-nums">{formatRupiah(p.received ?? p.amount)}</span>
            </div>
          ))}
          {b.payments.some((p) => (p.change ?? 0) > 0) && (
            <div className="flex justify-between text-muted"><span>Kembalian</span><span className="tabular-nums">{formatRupiah(b.payments.reduce((a, p) => a + (p.change ?? 0), 0))}</span></div>
          )}
        </div>
      )}
      {b.voidReason && <p className="text-sm text-rose-700">Void: {b.voidReason}</p>}
      {b.cancelReason && <p className="text-sm text-muted">Dibatalkan: {b.cancelReason}</p>}
      <div className="flex flex-wrap gap-2">
        {b.status === 'OPEN' && (
          <>
            <Button size="sm" variant="soft" onClick={() => setOrdering(true)}>Tambah pesanan</Button>
            <Button size="sm" onClick={() => openCheckout(b.id)}>Bayar</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking('cancel')}>Batalkan</Button>
          </>
        )}
        {(b.status === 'PAID' || b.status === 'VOID') && <Button size="sm" variant="soft" onClick={() => reprint.mutate()}>Cetak ulang</Button>}
        {b.status === 'PAID' && <Button size="sm" variant="danger" onClick={() => setAsking('void')}>Void</Button>}
      </div>
      {asking && <ReasonDialog title={asking === 'void' ? 'Void bill' : 'Batalkan bill'} onSubmit={confirmReason} onClose={() => setAsking(null)} />}
      {ordering && <OrderDialog billId={b.id} title={`Pesan · ${b.label}`} open onClose={() => setOrdering(false)} />}
    </div>
  );
}
