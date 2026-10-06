import type { MemberDto, Role } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MembersPage } from './MembersPage';

const sinta: MemberDto = { id: 'm1', code: 'M0001', name: 'Sinta', phone: '0811', levelId: 'l1', levelName: 'Gold', active: true, createdAt: '2026-10-01T03:00:00.000Z' };
afterEach(() => vi.unstubAllGlobals());

function setup(role: Role) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'u', name: 'U', username: 'u', role } });
    if (url.startsWith('/api/members') && init?.method === 'GET') return json([sinta]);
    if (url === '/api/members' && init?.method === 'POST') return json({ ...sinta, id: 'm2', code: 'M0002', name: 'Budi' });
    if (url === '/api/member-levels') return json([{ id: 'l1', name: 'Gold', timeDiscountPct: 10, fnbDiscountPct: 0, sortOrder: 0, active: true }]);
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MembersPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

it('kasir mencari dan melihat member tanpa tombol kelola', async () => {
  const f = setup('KASIR');
  expect(await screen.findByRole('row', { name: /M0001.*Sinta.*0811.*Gold/ })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '+ Member' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Level' })).not.toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Cari member'), 'sin');
  await waitFor(() => expect(f.mock.calls.some(([u]) => u === '/api/members?q=sin')).toBe(true));
  await userEvent.click(screen.getByRole('row', { name: /Sinta/ }));
  expect(screen.getByRole('heading', { name: 'Sinta' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nonaktifkan' })).not.toBeInTheDocument();
});

it('supervisor menambah member', async () => {
  const f = setup('SUPERVISOR');
  await userEvent.click(await screen.findByRole('button', { name: '+ Member' }));
  const dlg = await screen.findByRole('dialog', { name: 'Tambah member' });
  await userEvent.type(within(dlg).getByLabelText('Nama'), 'Budi');
  await userEvent.type(within(dlg).getByLabelText('No. HP'), '0822');
  await within(dlg).findByRole('option', { name: 'Gold' }); // level dimuat async
  await userEvent.selectOptions(within(dlg).getByLabelText('Level'), 'l1');
  await userEvent.click(within(dlg).getByRole('button', { name: 'Simpan' }));
  await waitFor(() => {
    const call = f.mock.calls.find(([u, i]) => u === '/api/members' && i?.method === 'POST');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ name: 'Budi', phone: '0822', levelId: 'l1' });
  });
});
