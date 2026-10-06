import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type ShiftSummary } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { ShiftPage } from './ShiftPage';

const summary: ShiftSummary = {
  shift: { id: 's1', openedAt: '2026-10-01T01:00:00.000Z', openedByName: 'Andi', openingCash: 100000, closedAt: null, closedByName: null, countedCash: null, expectedCash: null, note: null },
  sales: { CASH: 56000, QRIS: 26000, CARD: 0, TRANSFER: 0, DEPOSIT: 0 },
  voids: { CASH: 0, QRIS: 0, CARD: 0, TRANSFER: 0, DEPOSIT: 0 },
  billCount: 2,
  voidCount: 0, depositChange: 0,
  expectedCash: 156000,
};

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('menampilkan kas seharusnya, selisih, dan menutup shift', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/shifts/current') return json({ summary });
    if (url === '/api/shifts') return json([]);
    if (url === '/api/shifts/current/close' && init?.method === 'POST') return json({ summary: { ...summary, shift: { ...summary.shift, closedAt: '2026-10-01T09:00:00.000Z' } } });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ShiftPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Rp 156.000')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Kas fisik'), '150000');
  expect(screen.getByTestId('shift-difference')).toHaveTextContent('-Rp 6.000');
  await userEvent.click(screen.getByRole('button', { name: 'Tutup shift' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/shifts/current/close');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ countedCash: 150000 });
  });
});

it('DP booking ditandai non-kas dan kembalian DP ditampilkan', async () => {
  const withDp: ShiftSummary = { ...summary, sales: { ...summary.sales, DEPOSIT: 40000 }, depositChange: 10000, expectedCash: 146000 };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/shifts/current') return json({ summary: withDp });
    if (url === '/api/shifts') return json([]);
    return new Response('{}', { status: 404 });
  }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ShiftPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Penjualan DP booking (non-kas)')).toBeInTheDocument();
  expect(screen.getByText('Kembalian DP (tunai keluar)')).toBeInTheDocument();
  expect(screen.getByText('-Rp 10.000')).toBeInTheDocument();
});
