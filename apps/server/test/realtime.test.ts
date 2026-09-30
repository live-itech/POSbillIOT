import type { BoardSnapshot, UnitView } from '@funplay/shared';
import { io, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { loginAs, makeApp, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let url: string;
let sockets: Socket[] = [];

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  const addr = t.app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  url = `http://127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  sockets.forEach((s) => s.disconnect());
  sockets = [];
  await t.app.close();
});

function connect(cookie?: string): Socket {
  const s = io(url, { path: '/socket.io', transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, reconnection: false });
  sockets.push(s);
  return s;
}

it('mengirim snapshot board saat terhubung', async () => {
  const cookie = await loginAs(t.app, 'kasir');
  const s = connect(cookie);
  const board = await new Promise<BoardSnapshot>((resolve) => s.once('board', resolve));
  expect(board.units).toHaveLength(3);
  expect(board.serverTime).toBe('2026-10-01T03:00:00.000Z');
});

it('mengirim update meja saat sesi dimulai', async () => {
  const cookie = await loginAs(t.app, 'kasir');
  const s = connect(cookie);
  await new Promise((resolve) => s.once('board', resolve));
  const update = new Promise<UnitView>((resolve) => {
    s.on('unit', (u: UnitView) => {
      if (u.id === b.m1.id && u.session) resolve(u);
    });
  });
  await t.app.inject({ method: 'POST', url: '/api/sessions', headers: { cookie }, payload: { unitId: b.m1.id, mode: 'OPEN' } });
  expect((await update).session?.status).toBe('RUNNING');
});

it('menolak koneksi tanpa login', async () => {
  const s = connect();
  const err = await new Promise<Error>((resolve) => s.once('connect_error', resolve));
  expect(err.message).toBe('UNAUTHORIZED');
});
