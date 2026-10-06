import { BOOKING_STATUS_LABEL, DEPOSIT_OUTCOME_LABEL, localHHMM, type BookingView } from '@funplay/shared';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useBookings } from '../../hooks/useBookings';
import { useNow } from '../../hooks/useNow';
import { cn } from '../../lib/cn';
import { formatRupiah, localDateInput, localDayRange } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { BookingDetail } from './BookingDetail';
import { BookingDialog } from './BookingDialog';
import { Timeline } from './Timeline';

function depositSuffix(b: BookingView): string {
  if (b.depositAmount === 0) return '';
  const state = b.depositOutcome ? ` (${DEPOSIT_OUTCOME_LABEL[b.depositOutcome]})` : b.depositBillStatus === 'OPEN' ? ' (belum dibayar)' : '';
  return ` · DP ${formatRupiah(b.depositAmount)}${state}`;
}

export function BookingsPage() {
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const units = useBoard(useShallow((s) => s.order.map((id) => s.units[id]!)));
  const now = useNow();
  const [date, setDate] = useState(() => localDateInput(new Date(), offset));
  const range = localDayRange(date, offset);
  const bookings = useBookings(range);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const list = bookings.data ?? [];
  const current = list.find((b) => b.id === selected) ?? null;

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[1fr_380px]">
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold">
            Tanggal
            <Input className="mt-1" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <Button className="ml-auto" onClick={() => setCreating(true)}>+ Booking</Button>
        </div>
        <Timeline units={units} bookings={list} dayStart={new Date(range.from)} now={now} offset={offset} onSelect={setSelected} />
        <ul aria-label="Booking hari ini" className="flex flex-col gap-1 rounded-2xl bg-surface p-2 shadow-sm">
          {list.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => setSelected(b.id)}
                className={cn('w-full rounded-xl px-3 py-2 text-left text-sm hover:bg-primary-soft/40', selected === b.id && 'bg-primary-soft')}
              >
                {`${localHHMM(new Date(b.startAt), offset)} · ${b.unitName} · ${b.customerName} · ${BOOKING_STATUS_LABEL[b.status]}${depositSuffix(b)}`}
              </button>
            </li>
          ))}
          {bookings.data?.length === 0 && <li className="p-2 text-sm text-muted">Belum ada booking.</li>}
        </ul>
      </section>
      <aside className="min-h-0 overflow-y-auto">
        {current ? <BookingDetail booking={current} now={now} /> : <p className="text-sm text-muted">Pilih booking untuk melihat detail.</p>}
      </aside>
      {creating && <BookingDialog date={date} onClose={() => setCreating(false)} />}
    </div>
  );
}
