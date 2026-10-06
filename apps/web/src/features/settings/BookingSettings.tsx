import type { FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useSettingsDraft } from './useSettingsDraft';

export function BookingSettings() {
  const { v, setV, save } = useSettingsDraft();
  if (!v) return null;
  const num = (k: 'bookingHoldMin' | 'bookingNoShowMin') => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ bookingHoldMin: v.bookingHoldMin, bookingNoShowMin: v.bookingNoShowMin });
  };
  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4 rounded-2xl bg-surface p-5 shadow-sm">
      <label className="text-sm font-semibold">
        Hold sebelum jadwal (menit)
        <Input className="mt-1" type="number" min={0} max={240} value={v.bookingHoldMin} onChange={num('bookingHoldMin')} />
      </label>
      <label className="text-sm font-semibold">
        No-show setelah jadwal (menit)
        <Input className="mt-1" type="number" min={1} max={240} value={v.bookingNoShowMin} onChange={num('bookingNoShowMin')} />
      </label>
      <p className="text-xs text-muted">
        Meja tampil Booked mulai sekian menit sebelum jadwal. Booking yang belum check-in sekian menit setelah jadwal otomatis menjadi no-show dan DP-nya hangus.
      </p>
      <Button type="submit" disabled={save.isPending} className="justify-self-start">Simpan</Button>
    </form>
  );
}
