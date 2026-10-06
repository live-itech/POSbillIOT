import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { UnitPanel } from './UnitPanel';

const booked: UnitView = {
  id: 'u1', name: 'Meja 1', sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, session: null,
  booking: { id: 'bk1', customerName: 'Budi', startAt: '2026-10-01T12:00:00.000Z', durationMin: 60, depositPaid: true },
};

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: {
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5,
      pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS,
    },
    units: { u1: booked },
    order: ['u1'],
    selectedUnitId: 'u1',
  });
});
afterEach(() => vi.unstubAllGlobals());

it('meja Booked: info booking, Mulai lain membuka mulai walk-in, Check-in mengirim check-in', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's1' } } });
    if (url === '/api/packages') return json([]);
    if (url === '/api/bookings/bk1/check-in' && init?.method === 'POST') return json({ unit: { ...booked, booking: null }, booking: { id: 'bk1' } });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnitPanel />
    </QueryClientProvider>,
  );
  expect(screen.getByText('Booked · Budi 19:00')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Mulai' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Mulai lain' }));
  expect(screen.getByRole('button', { name: 'Mulai' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Check-in' }));
  const dlg = await screen.findByRole('dialog', { name: 'Check-in · Budi' });
  await userEvent.click(within(dlg).getByRole('button', { name: 'Mulai' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/bookings/bk1/check-in');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ mode: 'OPEN' });
  });
});
