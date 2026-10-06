import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type MemberDto, type UnitView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { useToasts } from '../../stores/toast';
import { StartSession } from './StartSession';

const idle: UnitView = {
  id: 'u1', name: 'Meja 1', sortOrder: 1, unitTypeId: 'reg', unitTypeName: 'Reguler', unitTypeColor: '#7C3AED', area: '',
  deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null, light: null, deviceOnline: null, session: null, booking: null,
};
const sinta: MemberDto = { id: 'm1', code: 'M0001', name: 'Sinta', phone: '0811', levelId: 'l1', levelName: 'Gold', active: true, createdAt: '2026-10-01T03:00:00.000Z' };
const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } });

function setup(sessionsResponses: Response[]) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's1' } } });
    if (url === '/api/packages') return json([]);
    if (url.startsWith('/api/members')) return json([sinta]);
    if (url === '/api/sessions' && init?.method === 'POST') return sessionsResponses.shift() ?? json({ unit: idle });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <StartSession unit={idle} />
    </QueryClientProvider>,
  );
  return fetchMock;
}
const posts = (f: ReturnType<typeof vi.fn>) =>
  f.mock.calls.filter(([u, i]) => u === '/api/sessions' && i?.method === 'POST').map(([, i]) => JSON.parse(String(i!.body)));

beforeEach(() => {
  useToasts.setState({ toasts: [] });
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: {
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5,
      pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS,
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('BOOKING_HOLD: konfirmasi tanpa toast error, lalu Tetap mulai mengirim ignoreBooking', async () => {
  const hold = json({
    error: { code: 'BOOKING_HOLD', message: 'Meja 1 dibooking Budi jam 19:00', details: { booking: { id: 'bk1', customerName: 'Budi', startAt: '2026-10-01T12:00:00.000Z' } } },
  }, 409);
  const f = setup([hold]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mulai' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
  expect(await screen.findByText('Meja ini dibooking Budi jam 19:00. Tetap mulai?')).toBeInTheDocument();
  expect(useToasts.getState().toasts.some((t) => t.level === 'danger')).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: 'Tetap mulai' }));
  await waitFor(() => expect(posts(f)).toEqual([{ unitId: 'u1', mode: 'OPEN' }, { unitId: 'u1', mode: 'OPEN', ignoreBooking: true }]));
});

it('member yang dipilih ikut dikirim saat Mulai', async () => {
  const f = setup([]);
  await userEvent.click(screen.getByRole('button', { name: 'Pilih member' }));
  await userEvent.click(await screen.findByRole('button', { name: /M0001 · Sinta/ }));
  expect(screen.getByText('Member: Sinta (Gold)')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mulai' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Mulai' }));
  await waitFor(() => expect(posts(f)).toEqual([{ unitId: 'u1', mode: 'OPEN', memberId: 'm1' }]));
});
