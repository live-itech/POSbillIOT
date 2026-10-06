import { DEFAULT_TRANSACTION_SETTINGS } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PrinterSettings } from './PrinterSettings';
import { TransactionSettings } from './TransactionSettings';

const settings = { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS };

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/settings' && (!init || init.method === 'GET')) return json(settings);
    if (url === '/api/settings' && init?.method === 'PUT') return json({ ...settings, ...JSON.parse(String(init.body)) });
    if (url === '/api/print/test') return json({ id: 'j1', kind: 'TEST', status: 'PENDING', error: null, previewText: '', billId: null, shiftId: null, createdAt: '' });
    return new Response('{}', { status: 404 });
  });
}
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
afterEach(() => vi.unstubAllGlobals());

it('menyimpan pajak & cakupan', async () => {
  const f = mockFetch();
  vi.stubGlobal('fetch', f);
  wrap(<TransactionSettings />);
  const tax = await screen.findByLabelText('Pajak (%)');
  await userEvent.clear(tax);
  await userEvent.type(tax, '11');
  await userEvent.selectOptions(screen.getByLabelText('Cakupan pajak'), 'FNB');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => {
    const call = f.mock.calls.find(([u, i]) => u === '/api/settings' && i?.method === 'PUT');
    expect(JSON.parse(String(call![1]!.body))).toMatchObject({ taxPct: 11, taxScope: 'FNB', servicePct: 0, discountApprovalPct: 10 });
  });
});

it('printer LAN menampilkan host & port; tes cetak memanggil API', async () => {
  const f = mockFetch();
  vi.stubGlobal('fetch', f);
  wrap(<PrinterSettings />);
  await userEvent.selectOptions(await screen.findByLabelText('Driver printer'), 'LAN');
  expect(screen.getByLabelText('Host / IP')).toBeInTheDocument();
  expect(screen.getByLabelText('Port')).toHaveValue('9100');
  await userEvent.click(screen.getByRole('button', { name: 'Tes cetak' }));
  await waitFor(() => expect(f.mock.calls.some(([u]) => u === '/api/print/test')).toBe(true));
});
