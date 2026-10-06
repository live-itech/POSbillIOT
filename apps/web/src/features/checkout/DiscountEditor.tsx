import type { Discount, DiscountType } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { cn } from '../../lib/cn';

export function DiscountEditor({ title, initial, onSave, onClose }: { title: string; initial: Discount | null; onSave: (d: Discount | null) => void; onClose: () => void }) {
  const [type, setType] = useState<DiscountType>(initial?.type ?? 'PERCENT');
  const [value, setValue] = useState(initial ? String(initial.value) : '');
  const n = Number(value || 0);
  const invalid = type === 'PERCENT' && n > 100;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} width="max-w-xs"
      footer={
        <>
          <Button variant="ghost" onClick={() => onSave(null)}>Hapus diskon</Button>
          <Button disabled={invalid} onClick={() => onSave(n > 0 ? { type, value: n } : null)}>Simpan</Button>
        </>
      }>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(['AMOUNT', 'PERCENT'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}
            className={cn('rounded-lg py-2 text-sm font-bold', type === t ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
            {t === 'AMOUNT' ? 'Rp' : '%'}
          </button>
        ))}
      </div>
      <label className="text-sm font-semibold">
        Nilai diskon
        <Input className="mt-1" inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
      </label>
      {invalid && <p className="mt-1 text-sm text-rose-600">Diskon persen maksimal 100</p>}
    </Modal>
  );
}
