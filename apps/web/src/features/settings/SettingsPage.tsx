import { useState } from 'react';
import { cn } from '../../lib/cn';
import { CrudResource } from './CrudResource';
import { GeneralSettings } from './GeneralSettings';
import { RESOURCES } from './resources';

const TABS = [
  { key: 'general', label: 'Umum' },
  { key: 'unitTypes', label: 'Tipe' },
  { key: 'units', label: 'Meja / Unit' },
  { key: 'devices', label: 'Device' },
  { key: 'tariffs', label: 'Tarif' },
  { key: 'packages', label: 'Paket' },
  { key: 'users', label: 'User' },
] as const;

export function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('general');
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn('rounded-full px-4 py-1.5 text-sm font-semibold', tab === t.key ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'general' ? <GeneralSettings /> : <CrudResource key={tab} config={RESOURCES[tab]} />}
    </div>
  );
}
