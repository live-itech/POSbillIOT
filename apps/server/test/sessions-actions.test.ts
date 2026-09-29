import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const sim = () => t.sims.get(b.device.id)!;
const post = (url: string, payload: Record<string, unknown> = {}) => t.app.inject({ method: 'POST', url, headers: { cookie }, payload });
const startPkg = async (unitId = b.m1.id, packageId = b.pkg1.id) => (await post('/api/sessions', { unitId, mode: 'PACKAGE', packageId })).json().unit.session;
const startOpen = async (unitId = b.m1.id) => (await post('/api/sessions', { unitId, mode: 'OPEN' })).json().unit.session;

describe('pause & resume', () => {
  it('kasir tanpa PIN ditolak', async () => {
    const s = await startPkg();
    const res = await post(`/api/sessions/${s.id}/pause`);
    expect(res.json().error.code).toBe('APPROVAL_REQUIRED');
  });

  it('pause 10 menit menggeser plannedEndAt 10 menit', async () => {
    const s = await startPkg(); // 10:00–11:00 WIB
    t.clock.advanceMinutes(20);
    const p = await post(`/api/sessions/${s.id}/pause`, { approvalPin: '1111' });
    expect(p.json().unit.session.status).toBe('PAUSED');
    const pauseRow = await prisma.sessionPause.findFirstOrThrow();
    expect(pauseRow.approvedById).toBe(users.supervisor.id);
    t.clock.advanceMinutes(10);
    const r = await post(`/api/sessions/${s.id}/resume`);
    expect(r.json().unit.session).toMatchObject({ status: 'RUNNING', plannedEndAt: '2026-10-01T04:10:00.000Z' });
  });

  it('lampu mati saat pause bila pengaturan pauseKeepsLightOn=false', async () => {
    await prisma.setting.update({ where: { id: 1 }, data: { pauseKeepsLightOn: false } });
    const s = await startOpen();
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    await post(`/api/sessions/${s.id}/pause`, { approvalPin: '1111' });
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(false));
    await post(`/api/sessions/${s.id}/resume`);
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
  });

  it('resume tanpa pause → 409', async () => {
    const s = await startOpen();
    expect((await post(`/api/sessions/${s.id}/resume`)).json().error.code).toBe('SESSION_NOT_PAUSED');
  });
});

describe('extend', () => {
  it('menambah 30 menit sekali walau requestId dikirim dua kali', async () => {
    const s = await startPkg();
    const body = { minutes: 30, requestId: 'req-00000001' };
    await post(`/api/sessions/${s.id}/extend`, body);
    const res = await post(`/api/sessions/${s.id}/extend`, body);
    expect(res.statusCode).toBe(200);
    expect(res.json().unit.session.plannedEndAt).toBe('2026-10-01T04:30:00.000Z');
    expect(await prisma.sessionExtension.count()).toBe(1);
  });

  it('open billing tidak bisa ditambah waktu', async () => {
    const s = await startOpen();
    const res = await post(`/api/sessions/${s.id}/extend`, { minutes: 30, requestId: 'req-00000002' });
    expect(res.json().error.code).toBe('EXTEND_OPEN');
  });
});

describe('pindah meja', () => {
  it('memindah sesi, lampu ikut pindah, tagihan per tipe meja', async () => {
    const s = await startOpen(b.m1.id);
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    t.clock.advanceMinutes(30);
    const res = await post(`/api/sessions/${s.id}/move`, { toUnitId: b.v1.id });
    expect(res.statusCode).toBe(200);
    expect(res.json().unit).toMatchObject({ id: b.v1.id });
    expect(res.json().unit.session.segments).toHaveLength(2);
    await vi.waitFor(() => expect(sim().snapshot()).toEqual([false, false, true, false]));

    t.clock.advanceMinutes(30);
    const stop = await post(`/api/sessions/${s.id}/stop`);
    expect(stop.json().charge.lines.map((l: { label: string; minutes: number; amount: number }) => [l.label, l.minutes, l.amount])).toEqual([
      ['Reguler Siang', 30, 20000],
      ['VIP', 30, 40000],
    ]);
  });

  it('tidak bisa pindah ke meja terpakai / maintenance / meja yang sama', async () => {
    const s = await startOpen(b.m1.id);
    await startOpen(b.m2.id);
    expect((await post(`/api/sessions/${s.id}/move`, { toUnitId: b.m2.id })).json().error.code).toBe('UNIT_BUSY');
    await prisma.unit.update({ where: { id: b.v1.id }, data: { state: 'MAINTENANCE' } });
    expect((await post(`/api/sessions/${s.id}/move`, { toUnitId: b.v1.id })).json().error.code).toBe('UNIT_MAINTENANCE');
    expect((await post(`/api/sessions/${s.id}/move`, { toUnitId: b.m1.id })).json().error.code).toBe('SAME_UNIT');
  });
});
