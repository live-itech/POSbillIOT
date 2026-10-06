import type { AlertEvent, BoardSnapshot, DeviceStatusView, PrintJobView, UnitView } from '@funplay/shared';
import { io } from 'socket.io-client';
import { useBoard } from '../stores/board';

const RECONNECT_DELAY_MS = 2000;

export type RealtimeEvent =
  | { type: 'bill'; id: string }
  | { type: 'shift' }
  | { type: 'printJob'; job: PrintJobView }
  | { type: 'resync' };

export function connectBoard(onAlert: (a: AlertEvent) => void, onUnauthorized: () => void, onEvent: (e: RealtimeEvent) => void = () => {}): () => void {
  const socket = io({ path: '/socket.io', withCredentials: true });
  const store = useBoard.getState;
  let retry: ReturnType<typeof setTimeout> | null = null;
  socket.on('connect', () => {
    store().setConnected(true);
    onEvent({ type: 'resync' });
  });
  socket.on('disconnect', (reason) => {
    store().setConnected(false);
    // Server memutus koneksi (mis. gagal mengirim board): socket.io tidak menyambung ulang otomatis.
    if (reason === 'io server disconnect' && !retry) {
      retry = setTimeout(() => {
        retry = null;
        socket.connect();
      }, RECONNECT_DELAY_MS);
    }
  });
  socket.on('connect_error', (err) => {
    if (err.message === 'UNAUTHORIZED') onUnauthorized();
    else console.warn('socket connect_error:', err.message);
  });
  socket.on('board', (b: BoardSnapshot) => store().applyBoard(b, Date.now()));
  socket.on('unit', (u: UnitView) => store().applyUnit(u));
  socket.on('device', (d: DeviceStatusView) => store().applyDevice(d));
  socket.on('alert', onAlert);
  socket.on('bill', (p: { id: string }) => onEvent({ type: 'bill', id: p.id }));
  socket.on('shift', () => onEvent({ type: 'shift' }));
  socket.on('printJob', (job: PrintJobView) => onEvent({ type: 'printJob', job }));
  return () => {
    if (retry) clearTimeout(retry);
    retry = null;
    socket.disconnect();
  };
}
