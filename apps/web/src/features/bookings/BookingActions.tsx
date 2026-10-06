import type { BookingView } from '@funplay/shared';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useBookingAction } from '../../hooks/useBookings';
import { formatRupiah } from '../../lib/format';
import { approvalPin } from '../../stores/pin';
import { toast } from '../../stores/toast';
import { useMe } from '../auth/auth';

/** Batalkan booking; DP yang sudah dibayar: hangus atau dikembalikan (kasir butuh PIN supervisor). */
export function CancelBookingDialog({ booking, onClose }: { booking: BookingView; onClose: () => void }) {
  const me = useMe().data;
  const [reason, setReason] = useState('');
  const [deposit, setDeposit] = useState<'FORFEIT' | 'REFUND'>('FORFEIT');
  const action = useBookingAction();
  const dpPaid = booking.depositBillStatus === 'PAID' && booking.depositOutcome === null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!me) return;
    let pin: string | undefined;
    if (dpPaid) {
      const p = await approvalPin(me.role, 'PIN supervisor untuk membatalkan booking ber-DP');
      if (p === null) return;
      pin = p;
    }
    try {
      await action.mutateAsync({
        path: `/bookings/${booking.id}/cancel`,
        body: { reason: reason.trim(), ...(dpPaid ? { deposit } : {}), ...(pin ? { approvalPin: pin } : {}) },
      });
    } catch {
      return; // sudah ditampilkan oleh hook
    }
    toast.success('Booking dibatalkan');
    onClose();
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Batalkan booking ${booking.customerName}`}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="text-sm font-semibold">
          Alasan
          <Input className="mt-1" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {dpPaid && (
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="font-semibold">{`DP ${formatRupiah(booking.depositAmount)}`}</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="deposit" checked={deposit === 'FORFEIT'} onChange={() => setDeposit('FORFEIT')} /> DP hangus
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="deposit" checked={deposit === 'REFUND'} onChange={() => setDeposit('REFUND')} /> Kembalikan DP
            </label>
          </fieldset>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Kembali</Button>
          <Button type="submit" variant="danger" disabled={!reason.trim() || action.isPending}>Batalkan booking</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Kembalikan DP yang hangus (no-show/batal) atau belum dipakai setelah check-in. Kasir butuh PIN. */
export function RefundDepositDialog({ booking, onClose }: { booking: BookingView; onClose: () => void }) {
  const me = useMe().data;
  const [reason, setReason] = useState('');
  const action = useBookingAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!me) return;
    const pin = await approvalPin(me.role, 'PIN supervisor untuk mengembalikan DP');
    if (pin === null) return;
    try {
      await action.mutateAsync({ path: `/bookings/${booking.id}/refund-deposit`, body: { reason: reason.trim(), ...(pin ? { approvalPin: pin } : {}) } });
    } catch {
      return;
    }
    toast.success(`DP ${formatRupiah(booking.depositAmount)} dikembalikan`);
    onClose();
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Kembalikan DP">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <p className="text-sm">{`DP ${formatRupiah(booking.depositAmount)} dikembalikan tunai dan tercatat sebagai void di shift berjalan.`}</p>
        <label className="text-sm font-semibold">
          Alasan
          <Input className="mt-1" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" variant="warning" disabled={!reason.trim() || action.isPending}>Kembalikan</Button>
        </div>
      </form>
    </Modal>
  );
}
