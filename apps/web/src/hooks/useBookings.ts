import type { BookingView } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { showError } from '../stores/toast';

export function useBookings(range: { from: string; to: string }) {
  return useQuery({ queryKey: ['bookings', range], queryFn: () => api<BookingView[]>('GET', `/bookings?${new URLSearchParams(range)}`) });
}

/** Aksi booking (batal, kembalikan DP): POST → BookingView, lalu muat ulang daftar. */
export function useBookingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: Record<string, unknown> }) => api<BookingView>('POST', path, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bookings'] }),
    onError: showError,
  });
}
