import {
  computeBillTotals, computeSessionCharge, lineScope,
  type BillTotals, type BillView, type PublicSettings, type TariffRule, type TimeCharge, type TotalsLineInput,
} from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useBoard } from '../stores/board';
import { showError } from '../stores/toast';

export const billKey = (id: string) => ['bill', id] as const;

export function useBill(id: string | null) {
  return useQuery({ queryKey: billKey(id ?? ''), queryFn: () => api<BillView>('GET', `/bills/${id}`), enabled: !!id });
}

export function useBillAction(billId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ method, path, body }: { method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown }) => api<BillView>(method, path, body ?? {}),
    onSuccess: (b) => {
      qc.setQueryData(billKey(b.id), b);
      if (b.id !== billId) void qc.invalidateQueries({ queryKey: billKey(billId) });
      void qc.invalidateQueries({ queryKey: ['bills'] });
    },
    onError: showError,
  });
}

export interface BillPreview {
  totals: BillTotals;
  liveTime: { sessionId: string; unitName: string; charge: TimeCharge | null }[];
}

/** Total bill = baris tersimpan + biaya waktu sesi yang masih berjalan (kalkulator yang sama dengan server). */
export function computeBillPreview(bill: BillView, settings: PublicSettings, tariffs: TariffRule[], now: Date): BillPreview {
  const liveTime = bill.activeSessions.map((s) => {
    let charge: TimeCharge | null = null;
    try {
      charge = computeSessionCharge(s, tariffs, settings, now);
    } catch {
      charge = null;
    }
    return { sessionId: s.id, unitName: s.unitName, charge };
  });
  const lines: TotalsLineInput[] = [
    ...bill.lines.map((l) => ({ id: l.id, scope: lineScope(l.type), amount: l.unitPrice * l.qty, discount: l.discount })),
    ...liveTime.map((t) => ({ id: `live-${t.sessionId}`, scope: 'BILLING' as const, amount: t.charge?.total ?? 0, discount: null })),
  ];
  return { totals: computeBillTotals(lines, bill.billDiscount, settings), liveTime };
}

export function useBillPreview(bill: BillView | undefined, now: Date): BillPreview | null {
  const settings = useBoard((s) => s.settings);
  const tariffs = useBoard((s) => s.tariffs);
  if (!bill || !settings) return null;
  return computeBillPreview(bill, settings, tariffs, now);
}
