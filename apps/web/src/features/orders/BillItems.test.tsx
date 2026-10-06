import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type BillView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PinPrompt } from '../../components/PinPrompt';
import { useBoard } from '../../stores/board';
import { BillItems } from './BillItems';

const bill: BillView = {
  id: 'b1', number: 'FP-1', label: 'Meja 1', status: 'OPEN', createdAt: '', createdByName: 'k', billDiscount: null,
  lines: [{ id: 'l2', type: 'PRODUCT', productId: 'p1', sessionId: null, name: 'Es Teh', unitPrice: 8000, qty: 2, discount: null, breakdown: null }],
  activeSessions: [], payments: [], stored: null, paidAt: null, paidByName: null, shiftId: null, mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null, kind: 'SALE', booking: null, member: null,
};

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('kasir mengurangi qty → minta PIN lalu PATCH dengan approvalPin', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's' } } });
    if (url === '/api/bills/b1' && (!init || init.method === 'GET')) return json(bill);
    if (url === '/api/bills/b1/items/l2' && init?.method === 'PATCH') return json({ ...bill, lines: [{ ...bill.lines[0], qty: 1 }] });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BillItems billId="b1" />
      <PinPrompt />
    </QueryClientProvider>,
  );
  expect(await screen.findByTestId('bill-running-total')).toHaveTextContent('Rp 16.000');
  await userEvent.click(screen.getByRole('button', { name: 'Kurangi Es Teh' }));
  await userEvent.type(await screen.findByLabelText('PIN supervisor'), '1111');
  await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/bills/b1/items/l2' && i?.method === 'PATCH');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ qty: 1, approvalPin: '1111' });
  });
});
