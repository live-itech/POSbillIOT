import { DEFAULT_BOOKING_SETTINGS, DEFAULT_TRANSACTION_SETTINGS, type BillView, type MemberDto } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { CheckoutDialog } from './CheckoutDialog';

const bill: BillView = {
  id: 'b1', number: 'FP-20261001-0001', label: 'Meja 1', status: 'OPEN', kind: 'SALE', member: null, booking: null,
  createdAt: '2026-10-01T03:00:00.000Z', createdByName: 'Kasir', billDiscount: null,
  lines: [
    { id: 'l1', type: 'TIME', productId: null, sessionId: 's1', name: 'Meja 1 - Open billing', unitPrice: 40000, qty: 1, discount: null,
      breakdown: [{ kind: 'TARIFF', label: 'Reguler Siang', tariffId: 't', unitTypeId: 'reg', pricePerHour: 40000, minutes: 60, amount: 40000 }] },
    { id: 'l2', type: 'PRODUCT', productId: 'p1', sessionId: null, name: 'Es Teh', unitPrice: 8000, qty: 2, discount: null, breakdown: null },
  ],
  activeSessions: [], payments: [], stored: null, paidAt: null, paidByName: null, shiftId: null, mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null,
};
const goldMember = { id: 'm1', code: 'M0001', name: 'Sinta', levelName: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 5 };
const sinta: MemberDto = { id: 'm1', code: 'M0001', name: 'Sinta', phone: '0811', levelId: 'l1', levelName: 'Gold', active: true, createdAt: '2026-10-01T03:00:00.000Z' };
const withDeposit = (amount: number): BillView => ({
  ...bill,
  booking: { id: 'bk1', customerName: 'Budi', startAt: '2026-10-01T03:30:00.000Z', status: 'CHECKED_IN', deposit: { amount, available: true } },
});

function setup(b: BillView = bill, shift = true) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: shift ? { id: 'sh1' } : null });
    if (url === '/api/bills/b1') return json(b);
    if (url === '/api/bills/b1/checkout' && init?.method === 'POST') return json({ bill: { ...b, status: 'PAID' }, change: 44000, depositChange: 0 });
    if (url === '/api/bills/b1/member' && init?.method === 'PUT') return json({ ...b, member: goldMember });
    if (url.startsWith('/api/members')) return json([sinta]);
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
    settings: {
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5,
      pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS, ...DEFAULT_BOOKING_SETTINGS,
    },
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

it('member: diskon member per baris & total sama dengan server (Rp 51.200), tanpa PIN', async () => {
  const { fetchMock, onClose } = setup({ ...bill, member: goldMember });
  expect(await screen.findByTestId('checkout-total')).toHaveTextContent('Rp 51.200');
  expect(screen.getByText('Member: Sinta (Gold)')).toBeInTheDocument();
  expect(screen.getByTestId('checkout-member-discount')).toHaveTextContent('-Rp 4.800');
  expect(screen.getByText('Diskon member -Rp 4.000')).toBeInTheDocument();
  expect(screen.getByText('Diskon member -Rp 800')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Uang pas' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bayar' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const sent = body(fetchMock);
  expect(sent).toMatchObject({ expectedGrandTotal: 51200, payments: [{ method: 'CASH', amount: 51200, received: 51200 }] });
  expect(sent.approvalPin).toBeUndefined();
});

it('DP booking terisi otomatis; sisa dibayar tunai', async () => {
  const { fetchMock } = setup(withDeposit(50000));
  expect(await screen.findByTestId('checkout-deposit')).toHaveTextContent('Rp 50.000');
  expect(screen.getByTestId('checkout-remaining')).toHaveTextContent('Rp 6.000');
  expect(screen.queryByRole('button', { name: 'DP booking' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Uang pas' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bayar' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() =>
    expect(body(fetchMock).payments).toEqual([
      { method: 'DEPOSIT', amount: 50000, received: 50000 },
      { method: 'CASH', amount: 6000, received: 6000 },
    ]),
  );
});

it('DP melebihi total: kembali DP, bisa langsung bayar; DP bisa dihapus', async () => {
  setup(withDeposit(60000));
  expect(await screen.findByTestId('checkout-deposit-change')).toHaveTextContent('Rp 4.000');
  expect(screen.getByTestId('checkout-remaining')).toHaveTextContent('Rp 0');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Bayar' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Hapus DP booking' }));
  expect(screen.getByTestId('checkout-remaining')).toHaveTextContent('Rp 56.000');
  expect(screen.getByRole('button', { name: 'Pakai DP booking' })).toBeInTheDocument();
});

it('bill DEPOSIT: tanpa diskon, gabung, dan member', async () => {
  setup({
    ...bill, kind: 'DEPOSIT', label: 'DP · Budi · Meja 2 19:00',
    lines: [{ id: 'd1', type: 'DEPOSIT', productId: null, sessionId: null, name: 'DP booking Meja 2 01/10/2026 19:00', unitPrice: 50000, qty: 1, discount: null, breakdown: null }],
  });
  expect(await screen.findByTestId('checkout-total')).toHaveTextContent('Rp 50.000');
  for (const name of ['Diskon bill', 'Gabung bill lain', 'Pilih member', 'DP booking']) {
    expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  }
  expect(screen.queryByRole('button', { name: /^Diskon / })).not.toBeInTheDocument();
});

it('Pilih member memasang member lewat API', async () => {
  const { fetchMock } = setup();
  await userEvent.click(await screen.findByRole('button', { name: 'Pilih member' }));
  await userEvent.click(await screen.findByRole('button', { name: /M0001 · Sinta/ }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/bills/b1/member' && i?.method === 'PUT');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ memberId: 'm1' });
  });
});
