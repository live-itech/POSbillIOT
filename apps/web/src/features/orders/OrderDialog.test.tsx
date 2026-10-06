import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { OrderDialog } from './OrderDialog';

afterEach(() => vi.unstubAllGlobals());

it('memilih produk, item manual, lalu menambahkan ke bill', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/categories') return json([{ id: 'c1', name: 'Minuman', color: '#06B6D4', sortOrder: 0, active: true }]);
    if (url === '/api/products') return json([
      { id: 'p1', name: 'Es Teh', categoryId: 'c1', kind: 'STOCK', price: 8000, stockQty: 5, active: true },
      { id: 'p2', name: 'Kopi', categoryId: 'c1', kind: 'STOCK', price: 15000, stockQty: 0, active: true },
      { id: 'p3', name: 'Lama', categoryId: 'c1', kind: 'STOCK', price: 1000, stockQty: 1, active: false },
    ]);
    if (url === '/api/bills/b1/items' && init?.method === 'POST') return json({ id: 'b1' });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's' } } });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OrderDialog billId="b1" title="Pesan · Meja 1" open onClose={onClose} />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: /^Es Teh/ }));
  await userEvent.click(screen.getByRole('button', { name: /^Es Teh/ }));
  expect(screen.getByRole('button', { name: /Kopi/ })).toHaveTextContent('Stok habis');
  expect(screen.queryByRole('button', { name: /Lama/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Item manual' }));
  await userEvent.type(screen.getByLabelText('Nama item'), 'Charger');
  await userEvent.type(screen.getByLabelText('Harga'), '5000');
  await userEvent.click(screen.getByRole('button', { name: 'Masukkan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find(([u]) => u === '/api/bills/b1/items')!;
  expect(JSON.parse(String(call[1]!.body))).toEqual({ items: [{ productId: 'p1', qty: 2 }, { custom: { name: 'Charger', price: 5000 }, qty: 1 }] });
});

it('item manual dengan nama sama setelah dihapus tidak menggandakan baris', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/categories' || url === '/api/products') return json([]);
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's' } } });
    return new Response('{}', { status: 404 });
  }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OrderDialog billId="b1" title="Pesan" open onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  const addManual = async (name: string) => {
    await userEvent.click(screen.getByRole('button', { name: 'Item manual' }));
    await userEvent.type(screen.getByLabelText('Nama item'), name);
    await userEvent.type(screen.getByLabelText('Harga'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Masukkan' }));
  };
  await addManual('A');
  await addManual('B');
  await userEvent.click(screen.getByRole('button', { name: 'Kurangi A di keranjang' }));
  await addManual('B');
  const [first] = screen.getAllByRole('button', { name: 'Tambah B di keranjang' });
  await userEvent.click(first!);
  expect(screen.getAllByRole('button', { name: 'Tambah B di keranjang' })).toHaveLength(2);
  expect(screen.getAllByText('2')).toHaveLength(1);
});
