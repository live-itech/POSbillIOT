import { useState } from 'react';
import { cn } from '../../lib/cn';
import { CrudResource } from '../settings/CrudResource';
import { RESOURCES } from '../settings/resources';

const TABS = [
  { key: 'products', label: 'Produk & Layanan' },
  { key: 'categories', label: 'Kategori' },
] as const;

export function ProductsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('products');
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn('rounded-full px-4 py-1.5 text-sm font-semibold', tab === t.key ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
            {t.label}
          </button>
        ))}
      </div>
      <CrudResource key={tab} config={RESOURCES[tab]} />
    </div>
  );
}
