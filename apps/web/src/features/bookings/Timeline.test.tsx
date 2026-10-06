import type { BookingView } from '@funplay/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { Timeline } from './Timeline';

const bk: BookingView = {
  id: 'bk1', unitId: 'u2', unitName: 'Meja 2', customerName: 'Budi', phone: '', memberId: null, memberCode: null,
  startAt: '2026-10-01T12:00:00.000Z', durationMin: 60, note: '', status: 'BOOKED', depositAmount: 0, depositBillId: null,
  depositBillStatus: null, depositOutcome: null, depositUsedAmount: 0, saleBillId: null, cancelReason: null, createdByName: 'kasir',
  createdAt: '2026-10-01T03:00:00.000Z',
};

it('blok booking di baris mejanya; garis sekarang untuk hari ini; klik memilih booking', async () => {
  const onSelect = vi.fn();
  render(
    <Timeline
      units={[{ id: 'u1', name: 'Meja 1' }, { id: 'u2', name: 'Meja 2' }]}
      bookings={[bk]}
      dayStart={new Date('2026-09-30T17:00:00.000Z')}
      now={new Date('2026-10-01T03:00:00.000Z')}
      offset={420}
      onSelect={onSelect}
    />,
  );
  const block = within(screen.getByTestId('timeline-row-Meja 2')).getByRole('button', { name: 'Budi' });
  expect(within(screen.getByTestId('timeline-row-Meja 1')).queryByRole('button')).toBeNull();
  expect(screen.getByTestId('timeline-now')).toBeInTheDocument();
  await userEvent.click(block);
  expect(onSelect).toHaveBeenCalledWith('bk1');
});
