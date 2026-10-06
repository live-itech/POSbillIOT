import type { MemberDto } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { MemberPickerDialog } from './MemberPicker';

const sinta: MemberDto = { id: 'm1', code: 'M0001', name: 'Sinta', phone: '0811', levelId: 'l1', levelName: 'Gold', active: true, createdAt: '2026-10-01T03:00:00.000Z' };
afterEach(() => vi.unstubAllGlobals());

it('mencari member aktif lalu memilih', async () => {
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify([sinta]), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemberPickerDialog onPick={onPick} onClose={onClose} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('dialog', { name: 'Pilih member' })).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Cari member'), 'sin');
  await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/members?active=true&q=sin')).toBe(true));
  await userEvent.click(await screen.findByRole('button', { name: /M0001 · Sinta/ }));
  expect(onPick).toHaveBeenCalledWith(sinta);
  expect(onClose).toHaveBeenCalled();
});
