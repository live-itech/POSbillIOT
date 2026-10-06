import type { UnitView } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { showError } from '../../stores/toast';

/** `quiet(err)` true = error ditangani pemanggil (mis. konfirmasi BOOKING_HOLD), tidak di-toast. */
export function useSessionAction(opts: { quiet?: (err: unknown) => boolean } = {}) {
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) => api<{ unit: UnitView }>('POST', path, body ?? {}),
    onSuccess: (r) => {
      useBoard.getState().applyActionUnit(r.unit);
      useBoard.getState().select(r.unit.id);
    },
    onError: (err) => {
      if (!opts.quiet?.(err)) showError(err);
    },
  });
}
