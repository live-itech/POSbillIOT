import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type BillView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { CheckoutDialog } from './CheckoutDialog';

const bill: BillView = {
  id: 'b1', number: 'FP-20261001-0001', label: 'Meja 1', status: 'OPEN', createdAt: '2026-10-01T03:00:00.000Z', createdByName: 'Kasir', billDiscount: null,
  lines: [
    { id: 'l1', type: 'TIME', productId: null, sessionId: 's1', name: 'Meja 1 - Open billing', unitPrice: 40000, qty: 1, discount: null,
      breakdown: [{ kind: 'TARIFF', label: 'Reguler Siang', tariffId: 't', unitTypeId: 'reg', pricePerHour: 40000, minutes: 60, amount: 40000 }] },
    { id: 'l2', type: 'PRODUCT', productId: 'p1', sessionId: null, name: 'Es Teh', unitPrice: 8000, qty: 2, discount: null, breakdown: null },
  ],
  activeSessions: [], payments: [], stored: null, paidAt: null, paidByName: null, shiftId: null, mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null, kind: 'SALE', booking: null, member: null,
};

function setup(b: BillView = bill, shift = true) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: shift ? { id: 'sh1' } : null });
    if (url === '/api/bills/b1') return json(b);
    if (url === '/api/bills/b1/checkout' && init?.method === 'POST') return json({ bill: { ...b, status: 'PAID' }, change: 44000 });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CheckoutDialog billId="b1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { fetchMock, onClose };
}

const body = (f: ReturnType<typeof vi.fn>) => JSON.parse(String(f.mock.calls.find(([u]) => u === '/api/bills/b1/checkout')![1]!.body));

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('tunai dengan kembalian lalu bayar', async () => {
  const { fetchMock, onClose } = setup();
  expect(await screen.findByTestId('checkout-total')).toHaveTextContent('Rp 56.000');
  await userEvent.type(screen.getByLabelText('Nominal'), '100000');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah pembayaran' }));
  expect(screen.getByTestId('checkout-change')).toHaveTextContent('Rp 44.000');
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const sent = body(fetchMock);
  expect(sent).toMatchObject({ expectedGrandTotal: 56000, payments: [{ method: 'CASH', amount: 56000, received: 100000 }] });
  expect(sent.idempotencyKey.length).toBeGreaterThanOrEqual(8);
});

it('split QRIS + uang pas tunai; Bayar aktif hanya saat sisa 0', async () => {
  const { fetchMock } = setup();
  await screen.findByTestId('checkout-total');
  await userEvent.click(screen.getByRole('button', { name: 'QRIS' }));
  await userEvent.type(screen.getByLabelText('Nominal'), '30000');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah pembayaran' }));
  expect(screen.getByRole('button', { name: 'Bayar' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Tunai' }));
  await userEvent.click(screen.getByRole('button', { name: 'Uang pas' }));
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() =>
    expect(body(fetchMock).payments).toEqual([
      { method: 'QRIS', amount: 30000, reference: null },
      { method: 'CASH', amount: 26000, received: 26000 },
    ]),
  );
});

it('sesi masih berjalan → Bayar nonaktif dengan pesan', async () => {
  setup({ ...bill, activeSessions: [{ id: 's9', billId: 'b1', unitName: 'Meja 2', mode: 'OPEN', status: 'RUNNING', startedAt: '2026-10-01T03:00:00.000Z', plannedEndAt: null, endedAt: null, packageName: null, packageDurationMin: null, packagePrice: null, segments: [], pauses: [] }] });
  expect(await screen.findByText('Hentikan sesi meja terlebih dahulu')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bayar' })).toBeDisabled();
});

it('tanpa shift: Bayar nonaktif dengan alasan', async () => {
  setup(bill, false);
  expect(await screen.findByText('Buka shift dulu untuk menerima pembayaran')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bayar' })).toBeDisabled();
});
