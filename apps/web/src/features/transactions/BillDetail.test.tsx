import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type BillView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PinPrompt } from '../../components/PinPrompt';
import { useBoard } from '../../stores/board';
import { BillDetail } from './BillDetail';

const paid: BillView = {
  id: 'b1', number: 'FP-20261001-0001', label: 'Tagihan lepas', status: 'PAID', createdAt: '2026-10-01T03:00:00.000Z', createdByName: 'Kasir', billDiscount: null,
  lines: [{ id: 'l1', type: 'PRODUCT', productId: 'p1', sessionId: null, name: 'Kopi Susu', unitPrice: 15000, qty: 1, discount: null, breakdown: null }],
  activeSessions: [],
  payments: [{ id: 'pay1', method: 'CASH', amount: 15000, received: 20000, change: 5000, reference: null, createdAt: '2026-10-01T03:05:00.000Z' }],
  stored: { subtotal: 15000, discountTotal: 0, serviceTotal: 0, taxTotal: 0, grandTotal: 15000 },
  paidAt: '2026-10-01T03:05:00.000Z', paidByName: 'Kasir', shiftId: 's1', mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null, kind: 'SALE', member: null,
};

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('void bill lunas: alasan lalu PIN supervisor', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's1' } } });
    if (url === '/api/bills/b1' && (!init || init.method === 'GET')) return json(paid);
    if (url === '/api/bills/b1/void' && init?.method === 'POST') return json({ ...paid, status: 'VOID', voidReason: 'salah input' });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BillDetail billId="b1" />
      <PinPrompt />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Kopi Susu')).toBeInTheDocument();
  expect(screen.getByText(/Kembalian/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Void' }));
  await userEvent.type(screen.getByLabelText('Alasan'), 'salah input');
  await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
  await userEvent.type(await screen.findByLabelText('PIN supervisor'), '1111');
  await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/bills/b1/void');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ reason: 'salah input', approvalPin: '1111' });
  });
});
