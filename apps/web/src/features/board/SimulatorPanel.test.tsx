import type { UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { SimulatorPanel } from './SimulatorPanel';

const unit = (id: string, name: string, ch: number): UnitView => ({
  id, name, sortOrder: ch, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: 'd1', relayChannel: ch, state: 'ACTIVE', lightOverride: null, light: ch === 1, deviceOnline: true, session: null,
});

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    units: { a: unit('a', 'Meja 1', 1), b: unit('b', 'Meja 2', 2) },
    order: ['a', 'b'],
    devices: { d1: { id: 'd1', name: 'Sim A', driver: 'simulator', channels: 2, online: true, relays: [true, false], lastSeenAt: null } },
  });
});
afterEach(() => vi.unstubAllGlobals());

function renderAs(role: 'KASIR' | 'OWNER') {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === '/api/auth/me') return new Response(JSON.stringify({ user: { id: 'x', name: 'X', username: 'x', role } }), { status: 200 });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SimulatorPanel />
    </QueryClientProvider>,
  );
  return fetchMock;
}

it('owner melihat relay berlabel meja dan bisa menekannya', async () => {
  const fetchMock = renderAs('OWNER');
  await userEvent.click(await screen.findByRole('button', { name: /Simulator/ }));
  const relay2 = screen.getByRole('button', { name: 'Meja 2' });
  expect(screen.getByRole('button', { name: 'Meja 1' })).toHaveAttribute('aria-pressed', 'true');
  expect(relay2).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(relay2);
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/devices/d1/simulate');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ action: 'set', channel: 2, on: true });
  });
});

it('kasir tidak melihat simulator', async () => {
  renderAs('KASIR');
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByRole('button', { name: /Simulator/ })).toBeNull();
});
