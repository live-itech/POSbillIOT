import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  t = await makeApp();
});
afterEach(() => t.app.close());

const sim = () => t.sims.get(b.device.id)!;

describe('devices API', () => {
  it('owner membuat device simulator yang langsung online', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'POST', url: '/api/devices', headers: { cookie }, payload: { name: 'Sim B', driver: 'simulator', channels: 8 } });
    expect(res.statusCode).toBe(200);
    const id = res.json().id as string;
    await vi.waitFor(async () => {
      const list = (await t.app.inject({ method: 'GET', url: '/api/devices', headers: { cookie } })).json();
      expect(list.find((d: { id: string }) => d.id === id)).toMatchObject({ name: 'Sim B', channels: 8, online: true });
    });
  });

  it('device yang masih dipetakan ke meja tidak bisa dihapus', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'DELETE', url: `/api/devices/${b.device.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(409);
  });

  it('channel tidak bisa dikurangi di bawah channel yang dipakai', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'PATCH', url: `/api/devices/${b.device.id}`, headers: { cookie }, payload: { channels: 2 } });
    expect(res.json().error.code).toBe('CHANNEL_OUT_OF_RANGE');
  });
});

describe('override lampu', () => {
  it('kasir tanpa PIN ditolak', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'POST', url: `/api/units/${b.m1.id}/light`, headers: { cookie }, payload: { mode: 'ON', reason: 'bersih-bersih' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('APPROVAL_REQUIRED');
  });

  it('kasir dengan PIN supervisor menyalakan lampu dan tercatat di audit', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({
      method: 'POST', url: `/api/units/${b.m1.id}/light`, headers: { cookie },
      payload: { mode: 'ON', reason: 'bersih-bersih', approvalPin: '1111' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().unit).toMatchObject({ id: b.m1.id, lightOverride: true });
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'device.override' } });
    expect(log).toMatchObject({ userId: users.kasir.id, approvedById: users.supervisor.id, entityId: b.m1.id });

    const auto = await t.app.inject({
      method: 'POST', url: `/api/units/${b.m1.id}/light`, headers: { cookie },
      payload: { mode: 'AUTO', reason: 'selesai', approvalPin: '1111' },
    });
    expect(auto.json().unit.lightOverride).toBeNull();
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(false));
  });
});

describe('simulate', () => {
  it('supervisor bisa memencet relay virtual, kasir tidak', async () => {
    const sup = await loginAs(t.app, 'supervisor');
    const ok = await t.app.inject({ method: 'POST', url: `/api/devices/${b.device.id}/simulate`, headers: { cookie: sup }, payload: { action: 'set', channel: 4, on: true } });
    expect(ok.statusCode).toBe(204);
    expect(sim().snapshot()[3]).toBe(true);
    const kasir = await loginAs(t.app, 'kasir');
    const no = await t.app.inject({ method: 'POST', url: `/api/devices/${b.device.id}/simulate`, headers: { cookie: kasir }, payload: { action: 'online', online: false } });
    expect(no.statusCode).toBe(403);
  });
});

describe('GET /api/board', () => {
  it('mengembalikan snapshot lengkap', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'GET', url: '/api/board', headers: { cookie } });
    const board = res.json();
    expect(board.serverTime).toBe('2026-10-01T03:00:00.000Z');
    expect(board.settings.outletType).toBe('BILLIARD');
    expect(board.tariffs).toHaveLength(3);
    expect(board.units.map((u: { name: string }) => u.name)).toEqual(['Meja 1', 'Meja 2', 'VIP 1']);
    expect(board.units[0]).toMatchObject({ unitTypeName: 'Reguler', light: false, deviceOnline: true, session: null });
    expect(board.devices[0]).toMatchObject({ id: b.device.id, online: true, relays: [false, false, false, false] });
  });
});
