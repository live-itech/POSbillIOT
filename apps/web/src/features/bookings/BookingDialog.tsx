import { memberLabel, type BookingView, type CreateBookingResult, type MemberDto } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { localDateInput, localDateTimeToIso, localTimeInput, parseRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { showError, toast } from '../../stores/toast';
import { MemberPickerDialog } from '../members/MemberPicker';

const DURATIONS = [30, 60, 90, 120];
const SLOT_MS = 30 * 60_000;
const chip = (on: boolean) => cn('rounded-full px-3 py-1.5 text-sm font-semibold', on ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink');

/** Buat booking (dengan DP opsional) atau ubah jadwal booking BOOKED. */
export function BookingDialog({ booking, date, onClose }: { booking?: BookingView; date: string; onClose: () => void }) {
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const units = useBoard(useShallow((s) => s.order.map((id) => s.units[id]!)));
  const edit = !!booking;
  const initialDuration = booking?.durationMin ?? 60;
  const [unitId, setUnitId] = useState(booking?.unitId ?? '');
  const [day, setDay] = useState(booking ? localDateInput(new Date(booking.startAt), offset) : date);
  const [time, setTime] = useState(() => localTimeInput(booking ? new Date(booking.startAt) : new Date(Math.ceil(Date.now() / SLOT_MS) * SLOT_MS), offset));
  const [duration, setDuration] = useState(initialDuration);
  const [custom, setCustom] = useState(!DURATIONS.includes(initialDuration));
  const [customMin, setCustomMin] = useState(String(initialDuration));
  const [member, setMember] = useState<{ id: string; label: string } | null>(
    booking?.memberId ? { id: booking.memberId, label: booking.memberCode ?? booking.customerName } : null,
  );
  const [picking, setPicking] = useState(false);
  const [customerName, setCustomerName] = useState(booking?.customerName ?? '');
  const [phone, setPhone] = useState(booking?.phone ?? '');
  const [note, setNote] = useState(booking?.note ?? '');
  const [deposit, setDeposit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>): Promise<string | null> => {
      if (booking) {
        await api<BookingView>('PATCH', `/bookings/${booking.id}`, body);
        return null;
      }
      return (await api<CreateBookingResult>('POST', '/bookings', body)).depositBillId;
    },
    onSuccess: (depositBillId) => {
      void qc.invalidateQueries({ queryKey: ['bookings'] });
      toast.success('Booking disimpan');
      onClose();
      if (depositBillId) useCheckout.getState().open(depositBillId); // DP > 0 → langsung bayar
    },
    onError: showError,
  });

  const pickMember = (m: MemberDto) => {
    setMember({ id: m.id, label: memberLabel(m) });
    if (!customerName.trim()) setCustomerName(m.name);
    if (!phone.trim()) setPhone(m.phone);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minutes = custom ? Number(customMin) : duration;
    if (!unitId) return setError('Pilih meja');
    if (!member && !customerName.trim()) return setError('Nama pelanggan wajib diisi');
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 720) return setError('Durasi 15–720 menit');
    setError(null);
    save.mutate({
      unitId,
      startAt: localDateTimeToIso(day, time, offset),
      durationMin: minutes,
      customerName: customerName.trim(),
      phone: phone.trim(),
      note: note.trim(),
      memberId: member?.id ?? null,
      ...(edit ? {} : { depositAmount: parseRupiah(deposit) }),
    });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={edit ? 'Ubah jadwal' : 'Booking baru'} width="max-w-lg">
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 text-sm font-semibold">
          <label htmlFor="bk-unit">Meja</label>
          <select id="bk-unit" className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">— pilih meja —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-semibold">
            Tanggal
            <Input className="mt-1" type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          </label>
          <label className="text-sm font-semibold">
            Jam
            <Input className="mt-1" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-semibold">Durasi</legend>
          <div className="flex flex-wrap gap-2">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={!custom && duration === d}
                className={chip(!custom && duration === d)}
                onClick={() => {
                  setCustom(false);
                  setDuration(d);
                }}
              >
                {`${d} mnt`}
              </button>
            ))}
            <button type="button" aria-pressed={custom} className={chip(custom)} onClick={() => setCustom(true)}>Lainnya</button>
          </div>
          {custom && (
            <label className="font-semibold">
              Durasi (menit)
              <Input className="mt-1" type="number" min={15} max={720} value={customMin} onChange={(e) => setCustomMin(e.target.value)} />
            </label>
          )}
        </fieldset>
        <div className="flex items-center justify-between rounded-xl bg-bg p-2 text-sm">
          <span className="font-semibold">{member ? `Member: ${member.label}` : 'Tanpa member'}</span>
          {member ? (
            <Button size="sm" variant="ghost" onClick={() => setMember(null)}>Lepas</Button>
          ) : (
            <Button size="sm" variant="soft" onClick={() => setPicking(true)}>Pilih member</Button>
          )}
        </div>
        <label className="text-sm font-semibold">
          Nama pelanggan
          <Input className="mt-1" maxLength={60} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          No. HP
          <Input className="mt-1" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="text-sm font-semibold">
          Catatan
          <Input className="mt-1" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {!edit && (
          <>
            <label className="text-sm font-semibold">
              DP (Rp)
              <Input className="mt-1" inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value.replace(/\D/g, ''))} />
            </label>
            <p className="text-xs text-muted">DP lebih dari 0 langsung dibayar lewat Checkout setelah disimpan.</p>
          </>
        )}
        {error && <p role="alert" className="text-sm font-semibold text-rose-600">{error}</p>}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={save.isPending}>Simpan booking</Button>
        </div>
      </form>
      {picking && <MemberPickerDialog onPick={pickMember} onClose={() => setPicking(false)} />}
    </Modal>
  );
}
