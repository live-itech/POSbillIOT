import type { ResourceConfig } from '../settings/CrudResource';

export const LEVEL_RESOURCE: ResourceConfig = {
  title: 'Level',
  path: '/member-levels',
  canDelete: true,
  fields: [
    { name: 'name', label: 'Nama', type: 'text', required: true },
    { name: 'timeDiscountPct', label: 'Diskon billing (%)', type: 'number', defaultValue: '0' },
    { name: 'fnbDiscountPct', label: 'Diskon FnB (%)', type: 'number', defaultValue: '0' },
    { name: 'sortOrder', label: 'Urutan', type: 'number', defaultValue: '0' },
    { name: 'active', label: 'Aktif', type: 'checkbox' },
  ],
};
