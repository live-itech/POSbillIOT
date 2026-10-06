import { localHHMM, type UnitBookingView, type UnitView } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { formatMinutes } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { CheckInDialog } from '../bookings/CheckInDialog';
import { StartSession } from './StartSession';

/** Panel meja yang di-hold booking: Check-in, atau Mulai lain (walk-in, memicu konfirmasi BOOKING_HOLD). */
export function BookedPanel({ unit, booking }: { unit: UnitView; booking: UnitBookingView }) {
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const [walkIn, setWalkIn] = useState(false);
  const [checkIn, setCheckIn] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-[#CFFAFE] p-3 text-sm text-cyan-950">
        <p className="font-bold">{`Booked · ${booking.customerName} ${localHHMM(new Date(booking.startAt), offset)}`}</p>
        <p>{`Durasi ${formatMinutes(booking.durationMin)} · ${booking.depositPaid ? 'DP sudah dibayar 💰' : 'tanpa DP terbayar'}`}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" onClick={() => setCheckIn(true)}>Check-in</Button>
        <Button size="lg" variant="soft" aria-expanded={walkIn} onClick={() => setWalkIn((v) => !v)}>Mulai lain</Button>
      </div>
      {walkIn && <StartSession unit={unit} />}
      {checkIn && <CheckInDialog booking={{ id: booking.id, customerName: booking.customerName, unitId: unit.id }} onClose={() => setCheckIn(false)} />}
    </div>
  );
}
