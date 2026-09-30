import type { UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
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
    return new Response('{}', { status: 404 });
  });
}

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false },
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
