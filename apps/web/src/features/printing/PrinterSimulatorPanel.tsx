import type { PrintJobView } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useBoard } from '../../stores/board';

const KIND_LABEL: Record<PrintJobView['kind'], string> = { RECEIPT: 'Struk', SHIFT_REPORT: 'Rekap shift', TEST: 'Tes cetak' };

export function PrinterSimulatorPanel() {
  const driver = useBoard((s) => s.settings?.printerDriver);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const jobs = useQuery({ queryKey: ['printJobs'], queryFn: () => api<PrintJobView[]>('GET', '/print/jobs?limit=20'), enabled: open && driver === 'SIMULATOR' });
  if (driver !== 'SIMULATOR') return null;
  if (!open) {
    return (
      <Button className="fixed bottom-4 left-20 z-30 shadow-lg" variant="soft" onClick={() => setOpen(true)}>
        <Printer size={16} /> Struk
      </Button>
    );
  }
  const list = jobs.data ?? [];
  const job = list.find((j) => j.id === picked) ?? list[0];
  return (
    <div className="fixed bottom-4 left-20 z-30 flex max-h-[80vh] w-[min(42rem,calc(100vw-6rem))] gap-3 rounded-2xl border border-line bg-surface p-4 shadow-2xl">
      <div className="flex w-44 flex-col gap-1 overflow-y-auto">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-bold">Simulator printer</h3>
          <button type="button" aria-label="Tutup simulator printer" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        {list.length === 0 && <p className="text-xs text-muted">Belum ada cetakan.</p>}
        {list.map((j) => (
          <button key={j.id} type="button" onClick={() => setPicked(j.id)}
            className={cn('rounded-lg px-2 py-1 text-left text-xs', job?.id === j.id ? 'bg-primary-soft font-bold' : 'hover:bg-bg')}>
            {KIND_LABEL[j.kind]} · {new Date(j.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            {j.status !== 'DONE' && <span className={j.status === 'FAILED' ? ' text-rose-600' : ' text-muted'}> · {j.status === 'FAILED' ? 'gagal' : 'proses'}</span>}
          </button>
        ))}
      </div>
      <pre data-testid="receipt-preview" className="min-w-0 flex-1 overflow-auto rounded-lg bg-white p-3 font-mono text-[11px] leading-tight text-black" style={{ maxWidth: '50ch' }}>
        {job?.previewText ?? ''}
      </pre>
    </div>
  );
}
