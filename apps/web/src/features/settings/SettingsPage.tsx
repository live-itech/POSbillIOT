import { useState } from 'react';
import { cn } from '../../lib/cn';
import { BookingSettings } from './BookingSettings';
import { CrudResource } from './CrudResource';
import { GeneralSettings } from './GeneralSettings';
import { PrinterSettings } from './PrinterSettings';
import { RESOURCES } from './resources';
import { TransactionSettings } from './TransactionSettings';

const TABS = [
  { key: 'general', label: 'Umum' },
  { key: 'transaction', label: 'Pajak & Service' },
  { key: 'printer', label: 'Struk & Printer' },
  { key: 'booking', label: 'Booking' },
  { key: 'unitTypes', label: 'Tipe' },
  { key: 'units', label: 'Meja / Unit' },
  { key: 'devices', label: 'Device' },
  { key: 'tariffs', label: 'Tarif' },
  { key: 'packages', label: 'Paket' },
  { key: 'users', label: 'User' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function TabBody({ tab }: { tab: TabKey }) {
  switch (tab) {
    case 'general':
      return <GeneralSettings />;
    case 'transaction':
      return <TransactionSettings />;
    case 'printer':
      return <PrinterSettings />;
    case 'booking':
      return <BookingSettings />;
    default:
      return <CrudResource key={tab} config={RESOURCES[tab]} />;
  }
}

export function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('general');
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
      <TabBody tab={tab} />
    </div>
  );
}
