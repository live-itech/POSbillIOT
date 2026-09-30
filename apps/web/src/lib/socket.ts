import type { AlertEvent, BoardSnapshot, DeviceStatusView, UnitView } from '@funplay/shared';
import { io } from 'socket.io-client';
import { useBoard } from '../stores/board';

export function connectBoard(onAlert: (a: AlertEvent) => void): () => void {
  const socket = io({ path: '/socket.io', withCredentials: true });
  const store = useBoard.getState;
  socket.on('connect', () => store().setConnected(true));
  socket.on('disconnect', (reason) => {
    store().setConnected(false);
    // Server memutus koneksi (mis. gagal mengirim board): socket.io tidak menyambung ulang otomatis.
    if (reason === 'io server disconnect') socket.connect();
  });
  socket.on('board', (b: BoardSnapshot) => store().applyBoard(b, Date.now()));
  socket.on('unit', (u: UnitView) => store().applyUnit(u));
  socket.on('device', (d: DeviceStatusView) => store().applyDevice(d));
  socket.on('alert', onAlert);
  return () => {
    socket.disconnect();
  };
}
