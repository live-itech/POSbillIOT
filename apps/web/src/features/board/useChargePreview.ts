import { computeSessionCharge, type SessionView, type TimeCharge } from '@funplay/shared';
import { useBoard } from '../../stores/board';

/** Preview tagihan waktu memakai kalkulator yang sama dengan server. null bila tarif belum diatur. */
export function useChargePreview(session: SessionView | null, now: Date): TimeCharge | null {
  const tariffs = useBoard((s) => s.tariffs);
  const settings = useBoard((s) => s.settings);
  if (!session || !settings) return null;
  try {
    return computeSessionCharge(session, tariffs, settings, now);
  } catch {
    return null;
  }
}
