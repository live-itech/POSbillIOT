import type { PublicSettings, Scope } from '@funplay/shared';
import type { FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useSettingsDraft } from './useSettingsDraft';

const SCOPE_LABEL: Record<Scope, string> = { NONE: 'Nonaktif', BILLING: 'Biaya waktu saja', FNB: 'FnB & layanan saja', ALL: 'Semua' };
const select = 'mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm';

export function TransactionSettings() {
  const { v, setV, save } = useSettingsDraft();
  if (!v) return null;
  const num = (k: keyof PublicSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  const scope = (k: 'taxScope' | 'serviceScope') => (
    <select id={k} className={select} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value as Scope })}>
      {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
    </select>
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ taxPct: v.taxPct, taxScope: v.taxScope, servicePct: v.servicePct, serviceScope: v.serviceScope, discountApprovalPct: v.discountApprovalPct });
  };

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4 rounded-2xl bg-surface p-5 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">Pajak (%)<Input className="mt-1" type="number" min={0} max={100} value={v.taxPct} onChange={num('taxPct')} /></label>
        <label className="text-sm font-semibold" htmlFor="taxScope">Cakupan pajak{scope('taxScope')}</label>
        <label className="text-sm font-semibold">Service (%)<Input className="mt-1" type="number" min={0} max={100} value={v.servicePct} onChange={num('servicePct')} /></label>
        <label className="text-sm font-semibold" htmlFor="serviceScope">Cakupan service{scope('serviceScope')}</label>
      </div>
      <label className="text-sm font-semibold">Batas diskon tanpa PIN supervisor (%)<Input className="mt-1" type="number" min={0} max={100} value={v.discountApprovalPct} onChange={num('discountApprovalPct')} /></label>
      <p className="text-xs text-muted">Urutan hitung: subtotal → diskon → service → pajak.</p>
      <Button type="submit" disabled={save.isPending} className="justify-self-start">Simpan</Button>
    </form>
  );
}
