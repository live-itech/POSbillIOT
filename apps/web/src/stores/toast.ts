import { create } from 'zustand';
import { ApiError } from '../lib/api';
import { newId } from '../lib/id';

export type ToastLevel = 'info' | 'success' | 'warning' | 'danger';
export interface Toast {
  id: string;
  level: ToastLevel;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  push(level: ToastLevel, message: string): void;
  dismiss(id: string): void;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (level, message) => {
    const id = newId();
    set((s) => ({ toasts: [...s.toasts, { id, level, message }].slice(-5) }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 6000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  info: (m: string) => useToasts.getState().push('info', m),
  success: (m: string) => useToasts.getState().push('success', m),
  warning: (m: string) => useToasts.getState().push('warning', m),
  error: (m: string) => useToasts.getState().push('danger', m),
};

export function showError(err: unknown): void {
  toast.error(err instanceof ApiError ? err.message : 'Terjadi kesalahan, coba lagi');
}
