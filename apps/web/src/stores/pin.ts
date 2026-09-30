import type { Role } from '@funplay/shared';
import { create } from 'zustand';

interface PinState {
  open: boolean;
  title: string;
  resolve: ((pin: string | null) => void) | null;
  ask(title: string): Promise<string | null>;
  close(pin: string | null): void;
}

export const usePin = create<PinState>((set, get) => ({
  open: false,
  title: '',
  resolve: null,
  ask: (title) => {
    get().resolve?.(null); // selesaikan prompt lama agar promise-nya tidak menggantung
    return new Promise((resolve) => set({ open: true, title, resolve }));
  },
  close: (pin) => {
    get().resolve?.(pin);
    set({ open: false, resolve: null });
  },
}));

export const askPin = (title: string) => usePin.getState().ask(title);

/** undefined = tidak perlu PIN (supervisor/owner); null = dibatalkan. */
export async function approvalPin(role: Role, title: string): Promise<string | undefined | null> {
  if (role !== 'KASIR') return undefined;
  return askPin(title);
}
