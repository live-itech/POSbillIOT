import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { BookingDialog } from './BookingDialog';

const unit = (id: string, name: string): UnitView => ({
  id, name, sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, session: null, booking: null,
});

beforeEach(() => {
  useCheckout.setState({ billId: null });
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: {
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5,
      pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS,
    },
    units: { u1: unit('u1', 'Meja 1'), u2: unit('u2', 'Meja 2') },
    order: ['u1', 'u2'],
  });
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/bookings' && init?.method === 'POST') return json({ booking: { id: 'bk1' }, depositBillId: 'dp1' });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BookingDialog date="2026-10-01" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { fetchMock, onClose };
}

it('nama pelanggan wajib bila tanpa member', async () => {
  const { fetchMock } = setup();
  await userEvent.selectOptions(screen.getByLabelText('Meja'), 'u2');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan booking' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Nama pelanggan wajib diisi');
  expect(fetchMock.mock.calls.some(([u]) => u === '/api/bookings')).toBe(false);
});

it('simpan dengan DP lalu Checkout bill DP terbuka', async () => {
  const { fetchMock, onClose } = setup();
  await userEvent.selectOptions(screen.getByLabelText('Meja'), 'u2');
  fireEvent.change(screen.getByLabelText('Jam'), { target: { value: '19:00' } });
  await userEvent.click(screen.getByRole('button', { name: '60 mnt' }));
  await userEvent.type(screen.getByLabelText('Nama pelanggan'), 'Budi');
  await userEvent.type(screen.getByLabelText('No. HP'), '0812');
  await userEvent.type(screen.getByLabelText('DP (Rp)'), '50000');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan booking' }));
  await waitFor(() => expect(useCheckout.getState().billId).toBe('dp1'));
  const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/bookings' && i?.method === 'POST');
  expect(JSON.parse(String(call![1]!.body))).toEqual({
    unitId: 'u2', startAt: '2026-10-01T12:00:00.000Z', durationMin: 60, customerName: 'Budi', phone: '0812', note: '', memberId: null, depositAmount: 50000,
  });
  expect(onClose).toHaveBeenCalled();
});
