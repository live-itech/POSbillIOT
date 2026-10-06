import { localHHMM } from '@funplay/shared';
import { NavLink } from 'react-router';
import { Button } from '../../components/ui/button';
import { useCurrentShift } from '../../hooks/useShift';
import { useBoard } from '../../stores/board';
import { useOpenShiftDialog } from './OpenShiftDialog';

export function ShiftChip() {
  const q = useCurrentShift();
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const show = useOpenShiftDialog((s) => s.show);
  if (q.isLoading) return null;
  if (!q.data) return <Button size="sm" variant="warning" onClick={show}>Buka shift</Button>;
  return (
    <NavLink to="/shift" className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
      Shift: {q.data.shift.openedByName} · sejak {localHHMM(new Date(q.data.shift.openedAt), offset)}
    </NavLink>
  );
}

export function NoShiftBanner() {
  const q = useCurrentShift();
  const show = useOpenShiftDialog((s) => s.show);
  if (q.isLoading || q.data) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
      Buka shift untuk mulai transaksi.
      <Button size="sm" variant="primary" onClick={show}>Buka shift sekarang</Button>
    </div>
  );
}
