import type { QueryClient } from '@tanstack/react-query';
import { toast } from '../stores/toast';
import type { RealtimeEvent } from './socket';

export function handleRealtime(qc: QueryClient, e: RealtimeEvent): void {
  const inv = (...key: string[]) => void qc.invalidateQueries({ queryKey: key });
  switch (e.type) {
    case 'bill':
      inv('bill', e.id);
      inv('bills');
      break;
    case 'shift':
      inv('shift');
      break;
    case 'printJob':
      inv('printJobs');
      if (e.job.status === 'FAILED') toast.error(`Cetak gagal: ${e.job.error ?? 'printer tidak merespons'}`);
      break;
    case 'booking':
      inv('bookings');
      break;
    case 'resync':
      for (const k of ['bills', 'bill', 'shift', 'printJobs', 'bookings']) inv(k);
      break;
  }
}
