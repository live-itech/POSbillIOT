import type { BillSummary } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { useCheckout } from '../../stores/checkout';

export function UnpaidStrip() {
  const q = useQuery({ queryKey: ['bills', { status: 'OPEN' }], queryFn: () => api<BillSummary[]>('GET', '/bills?status=OPEN') });
  const open = useCheckout((s) => s.open);
  const unpaid = (q.data ?? []).filter((b) => !b.hasActiveSession);
  if (!unpaid.length) return null;
  return (
    <div role="region" aria-label="Belum dibayar" className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
      <span className="text-sm font-bold text-amber-900 dark:text-amber-200">Belum dibayar:</span>
      {unpaid.map((b) => (
        <button key={b.id} type="button" onClick={() => open(b.id)}
          className="rounded-full bg-amber-200 px-3 py-1 text-sm font-semibold text-amber-950 hover:bg-amber-300">
          {b.label} · {formatRupiah(b.total)}
        </button>
      ))}
    </div>
  );
}
