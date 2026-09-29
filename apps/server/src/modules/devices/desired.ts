import type { SessionStatus } from '@funplay/shared';

export function desiredLight(override: boolean | null, sessionStatus: SessionStatus | null, pauseKeepsLightOn: boolean): boolean {
  if (override !== null) return override;
  switch (sessionStatus) {
    case 'RUNNING':
      return true;
    case 'PAUSED':
      return pauseKeepsLightOn;
    default:
      return false;
  }
}
