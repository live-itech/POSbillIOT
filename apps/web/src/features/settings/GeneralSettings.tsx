import type { PublicSettings } from '@funplay/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { showError, toast } from '../../stores/toast';

export function GeneralSettings() {
  const q = useQuery({ queryKey: ['/settings'], queryFn: () => api<PublicSettings>('GET', '/settings') });
  const [v, setV] = useState<PublicSettings | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: PublicSettings) => api<PublicSettings>('PUT', '/settings', body),
    onSuccess: () => toast.success('Pengaturan disimpan'),
    onError: showError,
  });
  if (!v) return null;

  const num = (k: keyof PublicSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(v);
  };

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4 rounded-2xl bg-surface p-5 shadow-sm">
      <label className="text-sm font-semibold">Jenis outlet
        <select className="mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3" value={v.outletType} onChange={(e) => setV({ ...v, outletType: e.target.value as PublicSettings['outletType'] })}>
          <option value="BILLIARD">Billiard (Meja)</option>
          <option value="PLAYSTATION">PlayStation (Unit)</option>
        </select>
      </label>
      <label className="text-sm font-semibold">Nama outlet<Input className="mt-1" value={v.outletName} onChange={(e) => setV({ ...v, outletName: e.target.value })} /></label>
      <label className="text-sm font-semibold">Alamat<Input className="mt-1" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></label>
      <div className="grid grid-cols-3 gap-3">
        <label className="text-sm font-semibold">Blok pembulatan (menit)<Input className="mt-1" type="number" value={v.roundingBlockMin} onChange={num('roundingBlockMin')} /></label>
        <label className="text-sm font-semibold">Minimum main (menit)<Input className="mt-1" type="number" value={v.minChargeMin} onChange={num('minChargeMin')} /></label>
        <label className="text-sm font-semibold">Peringatan (menit)<Input className="mt-1" type="number" value={v.warnBeforeMin} onChange={num('warnBeforeMin')} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-violet-600" checked={v.pauseKeepsLightOn} onChange={(e) => setV({ ...v, pauseKeepsLightOn: e.target.checked })} />
        Lampu tetap menyala saat pause
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-violet-600" checked={v.autoOffUnexpected} onChange={(e) => setV({ ...v, autoOffUnexpected: e.target.checked })} />
        Matikan otomatis lampu yang menyala tanpa sesi
      </label>
      <Button type="submit" disabled={save.isPending} className="justify-self-start">Simpan</Button>
    </form>
  );
}
