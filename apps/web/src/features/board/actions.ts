import type { UnitView } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useBoard } from '../../stores/board';
import { showError } from '../../stores/toast';

export function useSessionAction() {
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) => api<{ unit: UnitView }>('POST', path, body ?? {}),
    onSuccess: (r) => {
      useBoard.getState().applyUnit(r.unit);
      useBoard.getState().select(r.unit.id);
    },
    onError: showError,
  });
}
