import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, resetDb, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let users: Awaited<ReturnType<typeof seedUsers>>;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  t = await makeApp();
});
afterEach(() => t.app.close());

describe('settings', () => {
  it('GET mengembalikan default', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'GET', url: '/api/settings', headers: { cookie } });
    expect(res.json()).toEqual({
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15,
      minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false,
    });
  });
  it('kasir tidak boleh mengubah', async () => {
    const cookie = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { outletName: 'X' } });
    expect(res.statusCode).toBe(403);
  });
  it('owner mengubah sebagian & memicu board.changed', async () => {
    const cookie = await loginAs(t.app, 'owner');
    let fired = 0;
    t.ctx.bus.on('board.changed', () => fired++);
    const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { outletType: 'PLAYSTATION', roundingBlockMin: 30 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outletType: 'PLAYSTATION', roundingBlockMin: 30, minChargeMin: 60 });
    expect(fired).toBe(1);
  });
  it('validasi menolak blok pembulatan 0', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { roundingBlockMin: 0 } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });
});

describe('users', () => {
  it('owner membuat & melihat user', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({
      method: 'POST', url: '/api/users', headers: { cookie },
      payload: { name: 'Budi', username: 'budi', password: 'rahasia1', role: 'KASIR' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Budi', username: 'budi', role: 'KASIR', active: true, hasPin: false });
    const list = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(list.json()).toHaveLength(4);
    await loginAs(t.app, 'budi', 'rahasia1');
  });
  it('username duplikat → 409', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'POST', url: '/api/users', headers: { cookie }, payload: { name: 'K', username: 'kasir', password: 'rahasia1', role: 'KASIR' } });
    expect(res.statusCode).toBe(409);
  });
  it('owner tidak bisa menonaktifkan diri sendiri', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'PATCH', url: `/api/users/${users.owner.id}`, headers: { cookie }, payload: { active: false } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SELF_LOCKOUT');
  });
  it('PATCH mengganti PIN', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const res = await t.app.inject({ method: 'PATCH', url: `/api/users/${users.kasir.id}`, headers: { cookie }, payload: { pin: '4321' } });
    expect(res.json().hasPin).toBe(true);
  });
});
