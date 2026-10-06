import type { ResourceConfig } from './CrudResource';

const unitTypeSelect = { name: 'unitTypeId', label: 'Tipe', type: 'select' as const, required: true, optionsFrom: { path: '/unit-types', label: (r: { name: string }) => r.name } };

export const RESOURCES = {
  unitTypes: {
    title: 'Tipe',
    path: '/unit-types',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'color', label: 'Warna (#RRGGBB)', type: 'text', defaultValue: '#7C3AED' },
    ],
  },
  units: {
    title: 'Meja / Unit',
    path: '/units',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      unitTypeSelect,
      { name: 'area', label: 'Area', type: 'text' },
      { name: 'deviceId', label: 'Device', type: 'select', nullable: true, optionsFrom: { path: '/devices', label: (r: { name: string }) => r.name } },
      { name: 'relayChannel', label: 'Channel relay', type: 'number', nullable: true },
      { name: 'state', label: 'Status', type: 'select', defaultValue: 'ACTIVE', options: [{ value: 'ACTIVE', label: 'Aktif' }, { value: 'MAINTENANCE', label: 'Maintenance' }] },
      { name: 'sortOrder', label: 'Urutan', type: 'number', defaultValue: '0' },
    ],
  },
  devices: {
    title: 'Device',
    path: '/devices',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'driver', label: 'Driver', type: 'select', defaultValue: 'simulator', options: [{ value: 'simulator', label: 'Simulator' }] },
      { name: 'channels', label: 'Jumlah channel', type: 'number', defaultValue: '8' },
    ],
  },
  tariffs: {
    title: 'Tarif',
    path: '/tariffs',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      unitTypeSelect,
      { name: 'days', label: 'Hari', type: 'days' },
      { name: 'start', label: 'Mulai', type: 'time', defaultValue: '08:00' },
      { name: 'end', label: 'Selesai', type: 'time', defaultValue: '18:00' },
      { name: 'pricePerHour', label: 'Harga / jam', type: 'money', required: true },
      { name: 'priority', label: 'Prioritas', type: 'number', defaultValue: '0' },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
  packages: {
    title: 'Paket',
    path: '/packages',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      unitTypeSelect,
      { name: 'durationMin', label: 'Durasi (menit)', type: 'number', required: true },
      { name: 'price', label: 'Harga', type: 'money', required: true },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
  users: {
    title: 'User',
    path: '/users',
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'username', label: 'Username', type: 'text', required: true },
      { name: 'role', label: 'Peran', type: 'select', defaultValue: 'KASIR', options: [{ value: 'KASIR', label: 'Kasir' }, { value: 'SUPERVISOR', label: 'Supervisor' }, { value: 'OWNER', label: 'Owner' }] },
      { name: 'password', label: 'Password (kosongkan saat ubah)', type: 'password', required: true },
      { name: 'pin', label: 'PIN (4–6 digit, opsional)', type: 'password', omitIfEmpty: true },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
  categories: {
    title: 'Kategori',
    path: '/categories',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'color', label: 'Warna (#RRGGBB)', type: 'text', defaultValue: '#7C3AED' },
      { name: 'sortOrder', label: 'Urutan', type: 'number', defaultValue: '0' },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
  products: {
    title: 'Produk & Layanan',
    path: '/products',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'categoryId', label: 'Kategori', type: 'select', required: true, optionsFrom: { path: '/categories', label: (r: { name: string }) => r.name } },
      { name: 'kind', label: 'Jenis', type: 'select', defaultValue: 'STOCK', options: [{ value: 'STOCK', label: 'Stok (FnB)' }, { value: 'SERVICE', label: 'Layanan (tanpa stok)' }] },
      { name: 'price', label: 'Harga', type: 'money', required: true },
      { name: 'stockQty', label: 'Stok', type: 'number', defaultValue: '0' },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
} satisfies Record<string, ResourceConfig>;
