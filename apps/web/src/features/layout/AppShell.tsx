import { useEffect } from 'react';
import { LayoutGrid, LogOut, Moon, Settings } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/cn';
import { beep } from '../../lib/beep';
import { connectBoard } from '../../lib/socket';
import { toggleTheme } from '../../lib/theme';
import { toast } from '../../stores/toast';
import { useLogout, useMe } from '../auth/auth';

const ROLE_LABEL = { KASIR: 'Kasir', SUPERVISOR: 'Supervisor', OWNER: 'Owner' } as const;

export function AppShell() {
  const me = useMe().data!;
  const logout = useLogout();
  useEffect(
    () =>
      connectBoard((a) => {
        beep(a.level);
        if (a.level === 'danger') toast.error(a.message);
        else if (a.level === 'warning') toast.warning(a.message);
        else toast.info(a.message);
      }),
    [],
  );
  const items = [
    { to: '/', label: 'Meja', icon: LayoutGrid, show: true },
    { to: '/settings', label: 'Pengaturan', icon: Settings, show: me.role === 'OWNER' },
  ];

  return (
    <div className="flex h-full">
      <nav className="flex w-16 flex-col items-center gap-2 border-r border-line bg-surface py-4">
        <div className="mb-4 text-lg font-extrabold text-primary">F<span className="text-accent">P</span></div>
        {items.filter((i) => i.show).map((i) => (
          <NavLink
            key={i.to}
            to={i.to}
            end={i.to === '/'}
            title={i.label}
            className={({ isActive }) =>
              cn('grid h-11 w-11 place-items-center rounded-xl transition', isActive ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink hover:brightness-95')
            }
          >
            <i.icon size={20} />
          </NavLink>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2">
          <div className="text-lg font-extrabold text-primary">
            Fun<span className="text-accent">Play</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-full bg-primary-soft px-3 py-1 font-semibold text-primary-ink">
              {me.name} · {ROLE_LABEL[me.role]}
            </span>
            <Button variant="ghost" size="sm" aria-label="Mode gelap" onClick={toggleTheme}>
              <Moon size={16} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => logout.mutate()}>
              <LogOut size={16} /> Keluar
            </Button>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-hidden p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
