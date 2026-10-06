import { BOOKING_STATUS_LABEL, DEPOSIT_OUTCOME_LABEL, formatReceiptDate, isOnHold, localHHMM, type BookingView } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { formatMinutes, formatRupiah, localDateInput } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { CancelBookingDialog, RefundDepositDialog } from './BookingActions';
import { BookingDialog } from './BookingDialog';
import { CheckInDialog } from './CheckInDialog';

function depositText(b: BookingView): string {
  if (b.depositAmount === 0) return 'Tanpa DP';
  const state = b.depositOutcome
    ? DEPOSIT_OUTCOME_LABEL[b.depositOutcome]
    : b.depositBillStatus === 'PAID' ? 'sudah dibayar' : b.depositBillStatus === 'OPEN' ? 'belum dibayar' : 'tidak dibayar';
  return `${formatRupiah(b.depositAmount)} · ${state}`;
}

export function BookingDetail({ booking: b, now }: { booking: BookingView; now: Date }) {
  const settings = useBoard((s) => s.settings);
  const offset = settings?.utcOffsetMin ?? 420;
  const holdMin = settings?.bookingHoldMin ?? 15;
  const [dialog, setDialog] = useState<null | 'checkin' | 'edit' | 'cancel' | 'refund'>(null);
  const start = new Date(b.startAt);
  const end = new Date(start.getTime() + b.durationMin * 60_000);
  const dpPaid = b.depositBillStatus === 'PAID';
  const refundable =
    dpPaid &&
    (((b.status === 'NO_SHOW' || b.status === 'CANCELLED') && b.depositOutcome === 'FORFEITED') || (b.status === 'CHECKED_IN' && b.depositOutcome === null));
  const depositBillId = b.status === 'BOOKED' && b.depositBillStatus === 'OPEN' ? b.depositBillId : null;
  const close = () => setDialog(null);

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
      <header>
        <h2 className="text-xl font-extrabold">{b.customerName}</h2>
        <p className="text-sm text-muted">{BOOKING_STATUS_LABEL[b.status]}</p>
      </header>
      <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-sm">
        <dt className="text-muted">Meja</dt><dd>{b.unitName}</dd>
        <dt className="text-muted">Jadwal</dt><dd>{`${formatReceiptDate(start, offset)}–${localHHMM(end, offset)}`}</dd>
        <dt className="text-muted">Durasi</dt><dd>{formatMinutes(b.durationMin)}</dd>
        <dt className="text-muted">No. HP</dt><dd>{b.phone || '—'}</dd>
        {b.memberCode && (<><dt className="text-muted">Member</dt><dd>{b.memberCode}</dd></>)}
        {b.note && (<><dt className="text-muted">Catatan</dt><dd>{b.note}</dd></>)}
        <dt className="text-muted">DP</dt><dd>{depositText(b)}</dd>
        {b.cancelReason && (<><dt className="text-muted">Alasan batal</dt><dd>{b.cancelReason}</dd></>)}
      </dl>
      <div className="flex flex-wrap gap-2">
        {b.status === 'BOOKED' && isOnHold(b, now, holdMin) && <Button onClick={() => setDialog('checkin')}>Check-in</Button>}
        {depositBillId && <Button variant="soft" onClick={() => useCheckout.getState().open(depositBillId)}>Bayar DP</Button>}
        {b.status === 'BOOKED' && <Button variant="soft" onClick={() => setDialog('edit')}>Ubah jadwal</Button>}
        {b.status === 'BOOKED' && <Button variant="danger" onClick={() => setDialog('cancel')}>Batalkan</Button>}
        {refundable && <Button variant="warning" onClick={() => setDialog('refund')}>Kembalikan DP</Button>}
      </div>
      {dialog === 'checkin' && <CheckInDialog booking={{ id: b.id, customerName: b.customerName, unitId: b.unitId }} onClose={close} />}
      {dialog === 'edit' && <BookingDialog booking={b} date={localDateInput(start, offset)} onClose={close} />}
      {dialog === 'cancel' && <CancelBookingDialog booking={b} onClose={close} />}
      {dialog === 'refund' && <RefundDepositDialog booking={b} onClose={close} />}
    </section>
  );
}
