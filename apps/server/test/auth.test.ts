import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { approveWithPin } from '../src/modules/auth/auth.service';
import { requireRole } from '../src/modules/auth/guard';
import { loginAs, makeApp, prisma, resetDb, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let users: Awaited<ReturnType<typeof seedUsers>>;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  t = await makeApp({
    configure: (app) => {
      app.get('/api/_test/owner-only', { preHandler: requireRole('OWNER') }, async () => ({ ok: true }));
    },
  });
});
afterEach(() => t.app.close());

describe('login', () => {
  it('login benar mengeset cookie dan /me mengembalikan user', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ user: { id: users.kasir.id, name: 'kasir', username: 'kasir', role: 'KASIR' } });
    expect(await prisma.auditLog.count({ where: { action: 'auth.login' } })).toBe(1);
  });

  it('password salah → 401 INVALID_LOGIN', async () => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'kasir', password: 'salah' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_LOGIN');
  });

  it('/me tanpa cookie → 401', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('logout mematikan sesi login', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('user nonaktif tidak bisa memakai sesi lama', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    await prisma.user.update({ where: { id: users.kasir.id }, data: { active: false } });
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });
});

describe('requireRole', () => {
  it('kasir ditolak di rute owner', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'GET', url: '/api/_test/owner-only', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
  it('owner diterima', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'GET', url: '/api/_test/owner-only', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });
});

describe('approveWithPin', () => {
  const pub = (u: { id: string; name: string; username: string; role: 'KASIR' | 'SUPERVISOR' | 'OWNER' }) => ({ id: u.id, name: u.name, username: u.username, role: u.role });

  it('supervisor menyetujui dirinya sendiri tanpa PIN', async () => {
    expect(await approveWithPin(prisma, t.clock, pub(users.supervisor))).toBe(users.supervisor.id);
  });
  it('kasir tanpa PIN → APPROVAL_REQUIRED', async () => {
    await expect(approveWithPin(prisma, t.clock, pub(users.kasir))).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });
  it('kasir dengan PIN supervisor → id supervisor', async () => {
    expect(await approveWithPin(prisma, t.clock, pub(users.kasir), '1111')).toBe(users.supervisor.id);
  });
  it('5 kali PIN salah mengunci kasir 5 menit', async () => {
    for (let i = 0; i < 5; i++) {
      await expect(approveWithPin(prisma, t.clock, pub(users.kasir), '9999')).rejects.toMatchObject({ code: 'PIN_INVALID' });
    }
    await expect(approveWithPin(prisma, t.clock, pub(users.kasir), '1111')).rejects.toMatchObject({ code: 'PIN_LOCKED', status: 423 });
    t.clock.advanceMinutes(6);
    expect(await approveWithPin(prisma, t.clock, pub(users.kasir), '1111')).toBe(users.supervisor.id);
  });
});
