import { useSyncExternalStore } from 'react';
import { useBoard } from '../stores/board';

const listeners = new Set<() => void>();
let tick = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!timer) {
    tick = Date.now();
    timer = setInterval(() => {
      tick = Date.now();
      listeners.forEach((l) => l());
    }, 1000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Waktu server saat ini (jam lokal + offset), berdetak tiap detik. */
export function useNow(): Date {
  const local = useSyncExternalStore(subscribe, () => tick);
  const offset = useBoard((s) => s.offsetMs);
  return new Date(local + offset);
}
