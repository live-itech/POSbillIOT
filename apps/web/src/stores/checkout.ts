import { create } from 'zustand';

/** Dialog checkout global: tetap terbuka walau panel meja asalnya hilang (meja kosong setelah stop). */
export const useCheckout = create<{ billId: string | null; open(id: string): void; close(): void }>((set) => ({
  billId: null,
  open: (id) => set({ billId: id }),
  close: () => set({ billId: null }),
}));
