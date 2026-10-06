import type { PrinterDriver } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { showError, toast } from '../../stores/toast';
import { useSettingsDraft } from './useSettingsDraft';

const DRIVER_LABEL: Record<PrinterDriver, string> = { SIMULATOR: 'Simulator (pratinjau di layar)', USB: 'USB di server', LAN: 'LAN (TCP 9100)' };
const area = 'mt-1 min-h-20 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm';

export function PrinterSettings() {
  const { v, setV, save } = useSettingsDraft();
  const test = useMutation({ mutationFn: () => api('POST', '/print/test', {}), onSuccess: () => toast.success('Tes cetak dikirim'), onError: showError });
  if (!v) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      receiptHeader: v.receiptHeader, receiptFooter: v.receiptFooter,
      printerDriver: v.printerDriver, printerDevicePath: v.printerDevicePath, printerHost: v.printerHost, printerPort: v.printerPort,
    });
  };

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4 rounded-2xl bg-surface p-5 shadow-sm">
      <label className="text-sm font-semibold">Header struk<textarea className={area} value={v.receiptHeader} onChange={(e) => setV({ ...v, receiptHeader: e.target.value })} /></label>
      <label className="text-sm font-semibold">Footer struk<textarea className={area} value={v.receiptFooter} onChange={(e) => setV({ ...v, receiptFooter: e.target.value })} /></label>
      <label className="text-sm font-semibold">
        Driver printer
        <select className="mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={v.printerDriver} onChange={(e) => setV({ ...v, printerDriver: e.target.value as PrinterDriver })}>
          {(Object.keys(DRIVER_LABEL) as PrinterDriver[]).map((d) => <option key={d} value={d}>{DRIVER_LABEL[d]}</option>)}
        </select>
      </label>
      {v.printerDriver === 'USB' && (
        <label className="text-sm font-semibold">Path device<Input className="mt-1" value={v.printerDevicePath} onChange={(e) => setV({ ...v, printerDevicePath: e.target.value })} /></label>
      )}
      {v.printerDriver === 'LAN' && (
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <label className="text-sm font-semibold">Host / IP<Input className="mt-1" value={v.printerHost} onChange={(e) => setV({ ...v, printerHost: e.target.value })} /></label>
          <label className="text-sm font-semibold">Port<Input className="mt-1" inputMode="numeric" value={String(v.printerPort)} onChange={(e) => setV({ ...v, printerPort: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>Simpan</Button>
        <Button variant="soft" onClick={() => test.mutate()} disabled={test.isPending}>Tes cetak</Button>
      </div>
      <p className="text-xs text-muted">Simpan dulu sebelum tes cetak bila driver diubah.</p>
    </form>
  );
}
