import { needsDiscountApproval, type BillView, type CheckoutResult, type PaymentInput } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useNow } from '../../hooks/useNow';
import { billKey, useBill, useBillAction, useBillPreview } from '../../hooks/useBill';
import { api, ApiError } from '../../lib/api';
import { formatMinutes, formatRupiah } from '../../lib/format';
import { newId } from '../../lib/id';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { approvalPin } from '../../stores/pin';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';
import { DiscountEditor } from './DiscountEditor';
import { MergeDialog } from './MergeDialog';
import { PaymentComposer } from './PaymentComposer';

function Row({ label, value, testId, strong }: { label: string; value: string; testId?: string; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between border-t border-line pt-2 text-xl font-extrabold text-primary' : 'flex justify-between text-sm'}>
      <span>{label}</span>
      <span className="tabular-nums" data-testid={testId}>{value}</span>
    </div>
  );
}

export function CheckoutHost() {
  const { billId, close } = useCheckout();
  return billId ? <CheckoutDialog key={billId} billId={billId} onClose={close} /> : null;
}

function blockedReason(b: BillView): string | null {
  if (b.status !== 'OPEN') return 'Bill sudah tidak bisa dibayar';
  if (b.activeSessions.length) return 'Hentikan sesi meja terlebih dahulu';
  if (!b.lines.length) return 'Bill masih kosong';
  return null;
}

export function CheckoutDialog({ billId, onClose }: { billId: string; onClose: () => void }) {
  const me = useMe().data;
  const qc = useQueryClient();
  const bill = useBill(billId);
  const settings = useBoard((s) => s.settings);
  const now = useNow();
  const preview = useBillPreview(bill.data, now);
  const action = useBillAction(billId);
  const [payments, setPaymentsRaw] = useState<PaymentInput[]>([]);
  const [editing, setEditing] = useState<null | 'bill' | string>(null);
  const [merging, setMerging] = useState(false);
  // Satu kunci per upaya pembayaran: dipakai ulang saat klik ganda/ulang, diganti saat isi pembayaran berubah.
  const key = useRef(newId());
  const setPayments = (p: PaymentInput[]) => {
    key.current = newId();
    setPaymentsRaw(p);
  };

  const pay = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<CheckoutResult>('POST', `/bills/${billId}/checkout`, body),
    onSuccess: (r) => {
      qc.setQueryData(billKey(billId), r.bill);
      void qc.invalidateQueries({ queryKey: ['bills'] });
      toast.success(r.change > 0 ? `Lunas · kembalian ${formatRupiah(r.change)}` : 'Lunas');
      onClose();
    },
    onError: (err) => {
      showError(err);
      if (err instanceof ApiError && err.code === 'TOTAL_CHANGED') {
        setPayments([]);
        void bill.refetch();
      }
    },
  });

  if (!bill.data || !preview || !settings || !me) {
    return <Modal open onOpenChange={(o) => !o && onClose()} title="Bayar"><p className="text-sm text-muted">Memuat…</p></Modal>;
  }
  const b = bill.data;
  const t = preview.totals;
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const remaining = t.grandTotal - paid;
  const change = payments.reduce((a, p) => a + ((p.received ?? p.amount) - p.amount), 0);
  const blocked = blockedReason(b);

  const saveDiscount = (d: BillView['billDiscount']) => {
    const target = editing;
    setEditing(null);
    setPayments([]);
    if (target === 'bill') action.mutate({ method: 'PUT', path: `/bills/${billId}/discount`, body: { discount: d } });
    else if (target) action.mutate({ method: 'PATCH', path: `/bills/${billId}/items/${target}`, body: { discount: d } });
  };

  const submit = async () => {
    if (pay.isPending) return;
    let pin: string | undefined;
    if (needsDiscountApproval(t, settings.discountApprovalPct)) {
      const p = await approvalPin(me.role, 'PIN supervisor untuk diskon');
      if (p === null) return;
      pin = p;
    }
    pay.mutate({ idempotencyKey: key.current, expectedGrandTotal: t.grandTotal, payments, ...(pin ? { approvalPin: pin } : {}) });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Bayar · ${b.label}`} width="max-w-4xl">
      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <p className="text-xs text-muted">{b.number}</p>
          {b.lines.map((l, i) => (
            <div key={l.id} className="rounded-xl bg-bg p-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</span>
                <span className="tabular-nums">{formatRupiah(l.unitPrice * l.qty)}</span>
              </div>
              {l.breakdown && (
                <details className="text-xs text-muted">
                  <summary>Rincian tarif</summary>
                  {l.breakdown.map((c, j) => <div key={j}>{c.label} · {formatMinutes(c.minutes)} · {formatRupiah(c.amount)}</div>)}
                </details>
              )}
              <div className="flex items-center justify-between text-xs">
                {t.lines[i]!.itemDiscount > 0 ? <span className="text-emerald-700">Diskon -{formatRupiah(t.lines[i]!.itemDiscount)}</span> : <span />}
                <button type="button" className="font-semibold text-primary-ink" aria-label={`Diskon ${l.name}`} onClick={() => setEditing(l.id)}>Diskon</button>
              </div>
            </div>
          ))}
          {preview.liveTime.map((x) => (
            <div key={x.sessionId} className="flex justify-between rounded-xl bg-amber-50 p-2 text-sm text-amber-900">
              <span>{x.unitName} · sedang berjalan</span>
              <span className="tabular-nums">{formatRupiah(x.charge?.total ?? 0)}</span>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="soft" onClick={() => setEditing('bill')}>Diskon bill</Button>
            <Button size="sm" variant="soft" onClick={() => setMerging(true)}>Gabung bill lain</Button>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <Row label="Subtotal" value={formatRupiah(t.subtotal)} />
            {t.discountTotal > 0 && <Row label="Diskon" value={`-${formatRupiah(t.discountTotal)}`} />}
            {t.serviceTotal > 0 && <Row label="Service" value={formatRupiah(t.serviceTotal)} />}
            {t.taxTotal > 0 && <Row label="Pajak" value={formatRupiah(t.taxTotal)} />}
            <Row label="TOTAL" value={formatRupiah(t.grandTotal)} testId="checkout-total" strong />
          </div>
        </section>
        <section className="flex flex-col gap-3">
          <PaymentComposer remaining={remaining} payments={payments} onChange={setPayments} />
          <Row label="Sisa" value={formatRupiah(Math.max(0, remaining))} testId="checkout-remaining" />
          <Row label="Kembalian" value={formatRupiah(change)} testId="checkout-change" />
          {remaining < 0 && <p className="text-sm text-rose-600">Pembayaran melebihi total — hapus salah satu pembayaran.</p>}
          {blocked && <p className="text-sm font-semibold text-rose-600">{blocked}</p>}
          <Button size="lg" disabled={!!blocked || remaining !== 0 || pay.isPending} onClick={submit}>Bayar</Button>
        </section>
      </div>
      {editing && (
        <DiscountEditor
          title={editing === 'bill' ? 'Diskon bill' : 'Diskon item'}
          initial={editing === 'bill' ? b.billDiscount : (b.lines.find((l) => l.id === editing)?.discount ?? null)}
          onSave={saveDiscount}
          onClose={() => setEditing(null)}
        />
      )}
      {merging && <MergeDialog targetId={billId} onClose={() => setMerging(false)} />}
    </Modal>
  );
}
