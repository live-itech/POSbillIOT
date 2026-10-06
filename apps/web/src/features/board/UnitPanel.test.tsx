import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS } from '@funplay/shared';
import type { UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { PinPrompt } from '../../components/PinPrompt';
import { UnitPanel } from './UnitPanel';

const idle: UnitView = {
  id: 'u1', name: 'Meja 1', sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, session: null,
};

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/packages') return json([{ id: 'p1', name: 'Paket 2 Jam', unitTypeId: 'reg', durationMin: 120, price: 90000, active: true }]);
    if (url === '/api/sessions' && init?.method === 'POST') return json({ unit: { ...idle } });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's1', openedAt: '2026-10-01T01:00:00.000Z', openedByName: 'Kasir' } } });
    return new Response('{}', { status: 404 });
  });
}

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS },
    units: { u1: idle },
    order: ['u1'],
    selectedUnitId: 'u1',
  });
});
afterEach(() => vi.unstubAllGlobals());

it('memulai paket dari meja kosong', async () => {
  const fetchMock = mockFetch();
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnitPanel />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Paket' }));
  await userEvent.click(await screen.findByRole('button', { name: /Paket 2 Jam/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/sessions' && i?.method === 'POST');
    expect(call).toBeDefined();
    expect(JSON.parse(String(call![1]!.body))).toEqual({ unitId: 'u1', mode: 'PACKAGE', packageId: 'p1' });
  });
});

it('tombol Mulai nonaktif sampai paket dipilih', async () => {
  vi.stubGlobal('fetch', mockFetch());
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnitPanel />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Paket' }));
  expect(screen.getByRole('button', { name: 'Mulai' })).toBeDisabled();
});

const running = (id: string, unitTypeId = 'reg'): UnitView => ({
  ...idle,
  id,
  unitTypeId,
  session: {
    id: 's1', billId: 'b1', mode: 'OPEN', status: 'RUNNING', startedAt: new Date().toISOString(), plannedEndAt: null, endedAt: null,
    packageName: null, packageDurationMin: null, packagePrice: null, segments: [{ unitId: id, unitTypeId, startedAt: new Date().toISOString(), endedAt: null }], pauses: [],
  },
});

it('berganti meja mereset pilihan paket di StartSession', async () => {
  const fetchMock = mockFetch();
  vi.stubGlobal('fetch', fetchMock);
  const other: UnitView = { ...idle, id: 'u2', name: 'VIP 1', unitTypeId: 'vip' };
  useBoard.setState({ units: { u1: idle, u2: other }, order: ['u1', 'u2'] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnitPanel />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Paket' }));
  await userEvent.click(await screen.findByRole('button', { name: /Paket 2 Jam/ }));
  expect(screen.getByRole('button', { name: 'Mulai' })).toBeEnabled();
  act(() => useBoard.getState().select('u2'));
  expect(screen.getByRole('button', { name: 'Open billing' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Paket' }));
  expect(screen.getByRole('button', { name: 'Mulai' })).toBeDisabled();
});

function renderRunning() {
  const fetchMock = mockFetch();
  vi.stubGlobal('fetch', fetchMock);
  useBoard.setState({ units: { u1: running('u1') } });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnitPanel />
      <PinPrompt />
    </QueryClientProvider>,
  );
  return fetchMock;
}

it('pause oleh KASIR memakai PIN supervisor', async () => {
  const fetchMock = renderRunning();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.anything()));
  await screen.findByRole('button', { name: 'Pause' });
  await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
  await userEvent.type(await screen.findByLabelText('PIN supervisor'), '1111');
  await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/sessions/s1/pause');
    expect(call).toBeDefined();
    expect(JSON.parse(String(call![1]!.body))).toEqual({ approvalPin: '1111' });
  });
});

it('batal di prompt PIN tidak mengirim request pause', async () => {
  const fetchMock = renderRunning();
  await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Batal' }));
  await waitFor(() => expect(screen.queryByLabelText('PIN supervisor')).not.toBeInTheDocument());
  expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/pause'))).toBe(false);
});
