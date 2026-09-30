import type { AlertEvent } from '@funplay/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers, T0 } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;
let alerts: AlertEvent[];

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
  alerts = [];
  t.ctx.bus.on('alert', (a) => alerts.push(a));
});
afterEach(() => t.app.close());

const sim = () => t.sims.get(b.device.id)!;
const post = (url: string, payload: Record<string, unknown> = {}) => t.app.inject({ method: 'POST', url, headers: { cookie }, payload });

describe('Scheduler.tick', () => {
  it('memberi peringatan sekali ketika sisa ≤ 5 menit', async () => {
    await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id }); // berakhir 11:00
    t.clock.advanceMinutes(54);
    await t.ctx.scheduler.tick();
    expect(alerts).toHaveLength(0);
    t.clock.advanceMinutes(2); // 10:56
    await t.ctx.scheduler.tick();
    await t.ctx.scheduler.tick();
    expect(alerts.filter((a) => a.type === 'SESSION_WARNING')).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ unitId: b.m1.id, level: 'warning' });
  });

  it('auto-stop paket: EXPIRED, endedAt = plannedEndAt, lampu mati, tagihan = harga paket', async () => {
    const s = (await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().unit.session;
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    t.clock.advanceMinutes(61);
    await t.ctx.scheduler.tick();
    const row = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.status).toBe('EXPIRED');
    expect(row.endedAt?.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(alerts.map((a) => a.type)).toContain('SESSION_EXPIRED');
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(false));

    t.clock.advanceMinutes(20);
    const stop = await post(`/api/sessions/${s.id}/stop`);
    expect(stop.json().charge.total).toBe(45000);
  });

  it('tambah waktu setelah EXPIRED menghidupkan sesi lagi tanpa menagih jeda', async () => {
    const s = (await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().unit.session;
    t.clock.advanceMinutes(60);
    await t.ctx.scheduler.tick();
    t.clock.advanceMinutes(5); // 11:05
    const ext = await post(`/api/sessions/${s.id}/extend`, { minutes: 30, requestId: 'req-expired-01' });
    expect(ext.json().unit.session).toMatchObject({ status: 'RUNNING', plannedEndAt: '2026-10-01T04:35:00.000Z' });
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    t.clock.advanceMinutes(30);
    const stop = await post(`/api/sessions/${s.id}/stop`);
    expect(stop.json().charge.total).toBe(45000 + 20000);
  });

  it('sesi PAUSED tidak di-expire', async () => {
    const s = (await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().unit.session;
    await post(`/api/sessions/${s.id}/pause`, { approvalPin: '1111' });
    t.clock.advanceMinutes(90);
    await t.ctx.scheduler.tick();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('PAUSED');
  });
  it('race dengan extend: plannedEndAt sudah digeser di DB → sesi tidak di-expire dengan akhir lama', async () => {
    const s = (await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().unit.session;
    const expire = (t.ctx.scheduler as unknown as { expire: (id: string, uid: string, name: string, end: Date) => Promise<void> }).expire.bind(t.ctx.scheduler);
    const row = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    const staleEnd = row.plannedEndAt!;
    await prisma.session.update({ where: { id: s.id }, data: { plannedEndAt: new Date(staleEnd.getTime() + 30 * 60_000) } });
    await expire(s.id, b.m1.id, 'M1', staleEnd);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('RUNNING');
    expect(alerts.map((a) => a.type)).not.toContain('SESSION_EXPIRED');
  });

  it('kegagalan satu sesi tidak menghentikan sesi lain dalam tick yang sama', async () => {
    await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id });
    await post('/api/sessions', { unitId: b.m2.id, mode: 'PACKAGE', packageId: b.pkg1.id });
    t.clock.advanceMinutes(61);
    const spy = vi.spyOn(t.ctx.scheduler as unknown as { expire: () => Promise<void> }, 'expire').mockRejectedValueOnce(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await t.ctx.scheduler.tick();
    expect(await prisma.session.count({ where: { status: 'EXPIRED' } })).toBe(1);
    expect(err).toHaveBeenCalled();
    spy.mockRestore();
    err.mockRestore();
    await t.ctx.scheduler.tick();
    expect(await prisma.session.count({ where: { status: 'EXPIRED' } })).toBe(2);
  });
});

describe('restart recovery', () => {
  it('server mati melewati akhir paket → EXPIRED di plannedEndAt; sesi open tetap menyala di device baru', async () => {
    await post('/api/sessions', { unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg1.id });
    await post('/api/sessions', { unitId: b.m2.id, mode: 'OPEN' });
    await t.app.close();

    t = await makeApp({ now: new Date(T0.getTime() + 3 * 60 * 60_000) }); // 13:00 WIB, simulator baru (semua relay OFF)
    await t.ctx.scheduler.tick();
    await t.ctx.devices.reconcileAll();

    const pkgSession = await prisma.session.findFirstOrThrow({ where: { unitId: b.m1.id } });
    expect(pkgSession.status).toBe('EXPIRED');
    expect(pkgSession.endedAt?.toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(sim().snapshot().slice(0, 2)).toEqual([false, true]);
  });
});
