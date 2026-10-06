import { useEffect, useState, type FormEvent } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useOpenShift } from '../../hooks/useShift';
import { formatRupiah, parseRupiah } from '../../lib/format';

export const useOpenShiftDialog = create<{ open: boolean; show(): void; hide(): void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

export function OpenShiftDialog() {
  const { open, hide } = useOpenShiftDialog();
  const [cash, setCash] = useState('');
  const openShift = useOpenShift();
  useEffect(() => {
    if (open) setCash('');
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await openShift.mutateAsync(parseRupiah(cash));
      hide();
    } catch {
      // ditampilkan oleh hook
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && hide()} title="Buka shift" width="max-w-sm">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="text-sm font-semibold">
          Kas awal
          <Input className="mt-1" inputMode="numeric" autoFocus placeholder="0" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, ''))} />
        </label>
        <p className="text-sm text-muted">{formatRupiah(parseRupiah(cash))}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={hide}>Batal</Button>
          <Button type="submit" disabled={openShift.isPending}>Buka</Button>
        </div>
      </form>
    </Modal>
  );
}
