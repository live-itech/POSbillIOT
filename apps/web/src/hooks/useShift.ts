import type { ShiftSummary } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { showError, toast } from '../stores/toast';

export const SHIFT_KEY = ['shift', 'current'] as const;

export function useCurrentShift() {
  return useQuery({ queryKey: SHIFT_KEY, queryFn: () => api<{ summary: ShiftSummary | null }>('GET', '/shifts/current').then((r) => r.summary) });
}

export function useHasShift(): boolean {
  return !!useCurrentShift().data;
}

export function useOpenShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (openingCash: number) => api<{ summary: ShiftSummary }>('POST', '/shifts', { openingCash }),
    onSuccess: (r) => {
      qc.setQueryData(SHIFT_KEY, r.summary);
      toast.success('Shift dibuka');
    },
    onError: showError,
  });
}
