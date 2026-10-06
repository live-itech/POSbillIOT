import type { BillView } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useHasShift } from '../../hooks/useShift';
import { api } from '../../lib/api';
import { showError } from '../../stores/toast';
import { OrderDialog } from './OrderDialog';

export function NewBillButton() {
  const qc = useQueryClient();
  const hasShift = useHasShift();
  const [bill, setBill] = useState<BillView | null>(null);
  const create = useMutation({
    mutationFn: () => api<BillView>('POST', '/bills', {}),
    onSuccess: (b) => {
      qc.setQueryData(['bill', b.id], b);
      void qc.invalidateQueries({ queryKey: ['bills'] });
      setBill(b);
    },
    onError: showError,
  });
  return (
    <>
      <Button size="sm" variant="soft" disabled={!hasShift || create.isPending} onClick={() => create.mutate()}>+ Transaksi baru</Button>
      {bill && <OrderDialog billId={bill.id} title={`Pesan · ${bill.label}`} open onClose={() => setBill(null)} />}
    </>
  );
}
