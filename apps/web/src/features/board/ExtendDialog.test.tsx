import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ExtendDialog } from './ExtendDialog';

afterEach(() => vi.unstubAllGlobals());

it('requestId baru bila menit diganti setelah gagal; menit sama memakai requestId yang sama', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'Gagal' } }), { status: 500, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExtendDialog sessionId="s1" open onClose={() => {}} />
    </QueryClientProvider>,
  );
  const bodies = () => fetchMock.mock.calls.map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as { minutes: number; requestId: string });
  const submit = async (n: number) => {
    await userEvent.click(screen.getByRole('button', { name: /^Tambah \d+ menit$/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(n));
  };

  await submit(1);
  await submit(2); // coba lagi menit sama
  await userEvent.click(screen.getByRole('button', { name: '1 jam' }));
  await submit(3);
  await userEvent.click(screen.getByRole('button', { name: '30 mnt' }));
  await submit(4);

  const [a, b, c, d] = bodies();
  expect(a!.minutes).toBe(30);
  expect(b!.requestId).toBe(a!.requestId);
  expect(c!.minutes).toBe(60);
  expect(c!.requestId).not.toBe(a!.requestId);
  expect(d!.requestId).toBe(a!.requestId); // kembali ke 30: id lama dipakai lagi agar tidak dobel bila percobaan pertama sebenarnya berhasil
});
