import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrudResource, toPayload, type Field } from './CrudResource';

afterEach(() => vi.unstubAllGlobals());

describe('toPayload', () => {
  const fields: Field[] = [
    { name: 'name', label: 'Nama', type: 'text' },
    { name: 'price', label: 'Harga', type: 'money' },
    { name: 'relayChannel', label: 'Channel', type: 'number', nullable: true },
    { name: 'deviceId', label: 'Device', type: 'select', nullable: true },
    { name: 'active', label: 'Aktif', type: 'checkbox' },
    { name: 'days', label: 'Hari', type: 'days' },
    { name: 'pin', label: 'PIN', type: 'password', omitIfEmpty: true },
  ];
  it('mengonversi nilai form ke tipe API', () => {
    expect(toPayload(fields, { name: 'A', price: '45000', relayChannel: '', deviceId: '', active: true, days: [1, 2], pin: '' })).toEqual({
      name: 'A', price: 45000, relayChannel: null, deviceId: null, active: true, days: [1, 2],
    });
  });
});

describe('CrudResource', () => {
  it('menampilkan baris dan mengirim POST saat menambah', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'n', name: 'VIP', color: '#7C3AED' }), { status: 200 });
      return new Response(JSON.stringify([{ id: 'r', name: 'Reguler', color: '#7C3AED' }]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CrudResource
          config={{ title: 'Tipe', path: '/unit-types', canDelete: true, fields: [
            { name: 'name', label: 'Nama', type: 'text', required: true },
            { name: 'color', label: 'Warna', type: 'text', defaultValue: '#7C3AED' },
          ] }}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Reguler')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tambah' }));
    await userEvent.type(screen.getByLabelText('Nama'), 'VIP');
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST');
      expect(call?.[0]).toBe('/api/unit-types');
      expect(JSON.parse(String(call![1]!.body))).toEqual({ name: 'VIP', color: '#7C3AED' });
    });
  });
});
