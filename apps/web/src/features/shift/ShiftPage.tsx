import { formatReceiptDate, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type ShiftSummary, type ShiftView } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SHIFT_KEY, useCurrentShift } from '../../hooks/useShift';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRupiah, parseRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { showError, toast } from '../../stores/toast';
import { useOpenShiftDialog } from './OpenShiftDialog';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between py-1 text-sm', strong && 'border-t border-line pt-2 text-base font-extrabold text-primary')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CurrentShift({ s }: { s: ShiftSummary }) {
  const qc = useQueryClient();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const close = useMutation({
    mutationFn: () => api<{ summary: ShiftSummary }>('POST', '/shifts/current/close', { countedCash: parseRupiah(counted), note: note.trim() || undefined }),
    onSuccess: () => {
      qc.setQueryData(SHIFT_KEY, null);
      void qc.invalidateQueries({ queryKey: ['shift'] });
      toast.success('Shift ditutup');
    },
    onError: showError,
  });
  const diff = counted === '' ? null : parseRupiah(counted) - s.expectedCash;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-extrabold">Shift berjalan · {s.shift.openedByName}</h2>
        <Row label="Kas awal" value={formatRupiah(s.shift.openingCash)} />
        {PAYMENT_METHODS.map((m) => (
          <Row key={m} label={`Penjualan ${PAYMENT_METHOD_LABEL[m]}`} value={formatRupiah(s.sales[m])} />
        ))}
        {PAYMENT_METHODS.filter((m) => s.voids[m] > 0).map((m) => (
          <Row key={m} label={`Void ${PAYMENT_METHOD_LABEL[m]}`} value={`-${formatRupiah(s.voids[m])}`} />
        ))}
        <Row label="Jumlah bill" value={String(s.billCount)} />
        <Row label="Kas seharusnya" value={formatRupiah(s.expectedCash)} strong />
      </section>
      <section className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-extrabold">Tutup shift</h2>
        <label className="text-sm font-semibold">
          Kas fisik
          <Input className="mt-1" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div
          data-testid="shift-difference"
          className={cn(
            'rounded-xl px-3 py-2 text-sm font-bold',
            diff === null ? 'bg-bg text-muted' : diff === 0 ? 'bg-emerald-100 text-emerald-800' : Math.abs(diff) < 50000 ? 'bg-amber-100 text-amber-900' : 'bg-rose-100 text-rose-800',
          )}
        >
          Selisih: {diff === null ? '—' : formatRupiah(diff)}
        </div>
        <label className="text-sm font-semibold">
          Catatan
          <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
        <Button size="lg" variant="danger" disabled={counted === '' || close.isPending} onClick={() => close.mutate()}>Tutup shift</Button>
      </section>
    </div>
  );
}

export function ShiftPage() {
  const current = useCurrentShift();
  const show = useOpenShiftDialog((s) => s.show);
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const history = useQuery({ queryKey: ['shift', 'list'], queryFn: () => api<ShiftView[]>('GET', '/shifts') });
  const print = useMutation({
    mutationFn: (id: string) => api('POST', `/shifts/${id}/print`, {}),
    onSuccess: () => toast.success('Rekap dikirim ke printer'),
    onError: showError,
  });
  const when = (iso: string | null) => (iso ? formatReceiptDate(new Date(iso), offset) : '—');

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {current.data ? (
        <CurrentShift s={current.data} />
      ) : (
        <div className="flex items-center justify-between rounded-2xl bg-surface p-5 shadow-sm">
          <span className="font-semibold">Belum ada shift terbuka.</span>
          <Button onClick={show}>Buka shift sekarang</Button>
        </div>
      )}
      <section className="rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-extrabold">Riwayat shift</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th>Buka</th><th>Tutup</th><th>Kasir</th><th className="text-right">Seharusnya</th><th className="text-right">Dihitung</th><th className="text-right">Selisih</th><th /></tr>
          </thead>
          <tbody>
            {(history.data ?? []).map((h) => (
              <tr key={h.id} className="border-t border-line">
                <td className="py-2">{when(h.openedAt)}</td>
                <td>{when(h.closedAt)}</td>
                <td>{h.openedByName}</td>
                <td className="text-right tabular-nums">{h.expectedCash === null ? '—' : formatRupiah(h.expectedCash)}</td>
                <td className="text-right tabular-nums">{h.countedCash === null ? '—' : formatRupiah(h.countedCash)}</td>
                <td className="text-right tabular-nums">{h.countedCash === null || h.expectedCash === null ? '—' : formatRupiah(h.countedCash - h.expectedCash)}</td>
                <td className="text-right">{h.closedAt && <Button size="sm" variant="ghost" onClick={() => print.mutate(h.id)}>Cetak</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
