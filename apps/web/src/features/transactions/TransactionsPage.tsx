import { BILL_STATUS_LABEL, BILL_STATUSES, localHHMM, type BillStatus, type BillSummary } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRupiah, localDateInput, localDayRange } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { BillDetail } from './BillDetail';

export function TransactionsPage() {
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const [date, setDate] = useState(() => localDateInput(new Date(), offset));
  const [status, setStatus] = useState<'' | BillStatus>('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const range = localDayRange(date, offset);
  const params = new URLSearchParams({ from: range.from, to: range.to, ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const bills = useQuery({ queryKey: ['bills', { date, status, q }], queryFn: () => api<BillSummary[]>('GET', `/bills?${params}`) });

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[1fr_420px]">
      <section className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold">Tanggal<Input className="mt-1" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <label className="text-sm font-semibold">
            Status
            <select className="mt-1 h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as '' | BillStatus)}>
              <option value="">Semua</option>
              {BILL_STATUSES.map((s) => <option key={s} value={s}>{BILL_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">Cari<Input className="mt-1" placeholder="No. bill / label" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        <div className="min-h-0 overflow-y-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-muted">
              <tr><th className="p-3">No. bill</th><th>Label</th><th>Status</th><th>Jam</th><th className="pr-3 text-right">Total</th></tr>
            </thead>
            <tbody>
              {(bills.data ?? []).map((b) => (
                <tr key={b.id} onClick={() => setSelected(b.id)} className={cn('cursor-pointer border-t border-line hover:bg-primary-soft/40', selected === b.id && 'bg-primary-soft')}>
                  <td className="p-3 font-mono text-xs">{b.number}</td>
                  <td>{b.label}</td>
                  <td>{BILL_STATUS_LABEL[b.status]}</td>
                  <td>{localHHMM(new Date(b.createdAt), offset)}</td>
                  <td className="pr-3 text-right tabular-nums">{formatRupiah(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bills.data?.length === 0 && <p className="p-4 text-sm text-muted">Tidak ada transaksi.</p>}
        </div>
      </section>
      <aside className="min-h-0 overflow-y-auto">{selected ? <BillDetail key={selected} billId={selected} /> : <p className="text-sm text-muted">Pilih transaksi untuk melihat detail.</p>}</aside>
    </div>
  );
}
