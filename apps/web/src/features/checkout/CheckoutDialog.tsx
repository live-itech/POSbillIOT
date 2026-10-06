import { memberLabel, needsDiscountApproval, type BillView, type CheckoutResult, type PaymentInput } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useNow } from '../../hooks/useNow';
import { useHasShift } from '../../hooks/useShift';
import { billKey, useBill, useBillAction, useBillPreview } from '../../hooks/useBill';
import { api, ApiError } from '../../lib/api';
import { formatMinutes, formatRupiah } from '../../lib/format';
import { newId } from '../../lib/id';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { approvalPin } from '../../stores/pin';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';
import { MemberPickerDialog } from '../members/MemberPicker';
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

function blockedReason(b: BillView, hasShift: boolean): string | null {
  if (b.status !== 'OPEN') return 'Bill sudah tidak bisa dibayar';
  if (b.activeSessions.length) return 'Hentikan sesi meja terlebih dahulu';
  if (!b.lines.length) return 'Bill masih kosong';
  if (!hasShift) return 'Buka shift dulu untuk menerima pembayaran';
  return null;
}

/** Pembayaran DP booking otomatis (aturan server): amount = min(DP, total), received = DP. */
export function depositPaymentFor(b: BillView, grandTotal: number, enabled: boolean): PaymentInput | null {
  const dp = b.booking?.deposit;
  if (!enabled || b.kind !== 'SALE' || !dp?.available || dp.amount <= 0 || grandTotal <= 0) return null;
  return { method: 'DEPOSIT', amount: Math.min(dp.amount, grandTotal), received: dp.amount };
}

export function CheckoutDialog({ billId, onClose }: { billId: string; onClose: () => void }) {
  const me = useMe().data;
  const hasShift = useHasShift();
  const qc = useQueryClient();
  const bill = useBill(billId);
  const settings = useBoard((s) => s.settings);
  const now = useNow();
  const preview = useBillPreview(bill.data, now);
  const action = useBillAction(billId);
  const [payments, setPaymentsRaw] = useState<PaymentInput[]>([]);
  const [useDeposit, setUseDepositRaw] = useState(true);
  const [editing, setEditing] = useState<null | 'bill' | string>(null);
  const [merging, setMerging] = useState(false);
  const [picking, setPicking] = useState(false);
  // Satu kunci per upaya pembayaran: dipakai ulang saat klik ganda/ulang, diganti saat isi pembayaran berubah.
  const key = useRef(newId());
  const setPayments = (p: PaymentInput[]) => {
    key.current = newId();
    setPaymentsRaw(p);
  };
  const setUseDeposit = (v: boolean) => {
    key.current = newId();
    setUseDepositRaw(v);
  };

  const pay = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<CheckoutResult>('POST', `/bills/${billId}/checkout`, body),
    onSuccess: (r) => {
      qc.setQueryData(billKey(billId), r.bill);
      void qc.invalidateQueries({ queryKey: ['bills'] });
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      const parts = ['Lunas'];
      if (r.change > 0) parts.push(`kembalian ${formatRupiah(r.change)}`);
      if (r.depositChange > 0) parts.push(`kembali DP ${formatRupiah(r.depositChange)}`);
      toast.success(parts.join(' · '));
      onClose();
    },
    onError: (err) => {
      showError(err);
      if (err instanceof ApiError && (err.code === 'TOTAL_CHANGED' || err.code === 'DEPOSIT_NOT_AVAILABLE')) {
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
  const isDeposit = b.kind === 'DEPOSIT';
  const editable = b.status === 'OPEN' && !isDeposit;
  const depositPayment = depositPaymentFor(b, t.grandTotal, useDeposit);
  const all = depositPayment ? [depositPayment, ...payments] : payments;
  const paid = all.reduce((a, p) => a + p.amount, 0);
  const remaining = t.grandTotal - paid;
  const change = payments.reduce((a, p) => a + ((p.received ?? p.amount) - p.amount), 0);
  const depositChange = depositPayment ? (depositPayment.received ?? depositPayment.amount) - depositPayment.amount : 0;
  const otherDiscount = t.discountTotal - t.memberDiscountTotal;
  const canUseDeposit = !isDeposit && !!b.booking?.deposit?.available;
  const blocked = blockedReason(b, hasShift);

  const saveDiscount = (d: BillView['billDiscount']) => {
    const target = editing;
    setEditing(null);
    setPayments([]);
    if (target === 'bill') action.mutate({ method: 'PUT', path: `/bills/${billId}/discount`, body: { discount: d } });
    else if (target) action.mutate({ method: 'PATCH', path: `/bills/${billId}/items/${target}`, body: { discount: d } });
  };
  const setMember = (memberId: string | null) => {
    setPayments([]);
    action.mutate({ method: 'PUT', path: `/bills/${billId}/member`, body: { memberId } });
  };

  const submit = async () => {
    if (pay.isPending) return;
    let pin: string | undefined;
    if (needsDiscountApproval(t, settings.discountApprovalPct)) {
      const p = await approvalPin(me.role, 'PIN supervisor untuk diskon');
      if (p === null) return;
      pin = p;
    }
    pay.mutate({ idempotencyKey: key.current, expectedGrandTotal: t.grandTotal, payments: all, ...(pin ? { approvalPin: pin } : {}) });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Bayar · ${b.label}`} width="max-w-4xl">
      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <p className="text-xs text-muted">{b.number}{isDeposit ? ' · Tanda terima DP' : ''}</p>
          {!isDeposit && (
            <div className="flex items-center justify-between rounded-xl bg-bg p-2 text-sm">
              <span className="font-semibold">{b.member ? `Member: ${memberLabel(b.member)}` : 'Tanpa member'}</span>
              {editable &&
                (b.member ? (
                  <Button size="sm" variant="ghost" onClick={() => setMember(null)}>Lepas</Button>
                ) : (
                  <Button size="sm" variant="soft" onClick={() => setPicking(true)}>Pilih member</Button>
                ))}
            </div>
          )}
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
                <span className="flex flex-col">
                  {t.lines[i]!.itemDiscount > 0 && <span className="text-emerald-700">Diskon -{formatRupiah(t.lines[i]!.itemDiscount)}</span>}
                  {t.lines[i]!.memberDiscount > 0 && <span className="text-emerald-700">Diskon member -{formatRupiah(t.lines[i]!.memberDiscount)}</span>}
                </span>
                {editable && (
                  <button type="button" className="font-semibold text-primary-ink" aria-label={`Diskon ${l.name}`} onClick={() => setEditing(l.id)}>Diskon</button>
                )}
              </div>
            </div>
          ))}
          {preview.liveTime.map((x) => (
            <div key={x.sessionId} className="flex justify-between rounded-xl bg-amber-50 p-2 text-sm text-amber-900">
              <span>{x.unitName} · sedang berjalan</span>
              <span className="tabular-nums">{formatRupiah(x.charge?.total ?? 0)}</span>
            </div>
          ))}
          {editable && (
            <div className="flex gap-2">
              <Button size="sm" variant="soft" onClick={() => setEditing('bill')}>Diskon bill</Button>
              <Button size="sm" variant="soft" onClick={() => setMerging(true)}>Gabung bill lain</Button>
            </div>
          )}
          <div className="mt-2 flex flex-col gap-1">
            <Row label="Subtotal" value={formatRupiah(t.subtotal)} testId="checkout-subtotal" />
            {t.memberDiscountTotal > 0 && <Row label="Diskon member" value={`-${formatRupiah(t.memberDiscountTotal)}`} testId="checkout-member-discount" />}
            {otherDiscount > 0 && <Row label="Diskon" value={`-${formatRupiah(otherDiscount)}`} />}
            {t.serviceTotal > 0 && <Row label="Service" value={formatRupiah(t.serviceTotal)} />}
            {t.taxTotal > 0 && <Row label="Pajak" value={formatRupiah(t.taxTotal)} />}
            <Row label="TOTAL" value={formatRupiah(t.grandTotal)} testId="checkout-total" strong />
          </div>
        </section>
        <section className="flex flex-col gap-3">
          {depositPayment && (
            <div className="flex items-center justify-between rounded-xl bg-cyan-50 p-2 text-sm font-semibold text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100">
              <span>DP booking</span>
              <span className="flex items-center gap-2 tabular-nums">
                <span data-testid="checkout-deposit">{formatRupiah(depositPayment.received ?? depositPayment.amount)}</span>
                <button type="button" aria-label="Hapus DP booking" onClick={() => setUseDeposit(false)}><X size={14} /></button>
              </span>
            </div>
          )}
          {canUseDeposit && !depositPayment && (
            <Button size="sm" variant="soft" onClick={() => setUseDeposit(true)}>Pakai DP booking</Button>
          )}
          <PaymentComposer remaining={remaining} payments={payments} onChange={setPayments} />
          <Row label="Sisa" value={formatRupiah(Math.max(0, remaining))} testId="checkout-remaining" />
          <Row label="Kembalian" value={formatRupiah(change)} testId="checkout-change" />
          {depositChange > 0 && <Row label="Kembali DP (tunai)" value={formatRupiah(depositChange)} testId="checkout-deposit-change" />}
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
      {picking && <MemberPickerDialog onPick={(m) => setMember(m.id)} onClose={() => setPicking(false)} />}
    </Modal>
  );
}
