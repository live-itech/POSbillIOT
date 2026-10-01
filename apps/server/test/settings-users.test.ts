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
      taxPct: 0, taxScope: 'ALL', servicePct: 0, serviceScope: 'ALL', discountApprovalPct: 10,
      receiptHeader: '', receiptFooter: 'Terima kasih!',
      printerDriver: 'SIMULATOR', printerDevicePath: '/dev/usb/lp0', printerHost: '', printerPort: 9100,
    });
  });
  it('owner mengatur pajak, service, struk, dan printer', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const payload = {
      taxPct: 11, taxScope: 'FNB', servicePct: 5, serviceScope: 'ALL', discountApprovalPct: 20,
      receiptHeader: 'IG @funplay', receiptFooter: 'Sampai jumpa', printerDriver: 'LAN', printerHost: '192.168.1.50', printerPort: 9100,
    };
    const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject(payload);
  });

  it('persen di luar 0–100 dan cakupan tak dikenal ditolak', async () => {
    const cookie = await loginAs(t.app, 'owner');
    for (const payload of [{ taxPct: 101 }, { servicePct: -1 }, { taxScope: 'SEMUA' }, { printerDriver: 'BLUETOOTH' }, { printerPort: 70000 }]) {
      const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload });
      expect(res.statusCode).toBe(400);
    }
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
  it('pesan validasi bawaan dalam Bahasa Indonesia', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const tooBig = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { roundingBlockMin: 61 } });
    expect(tooBig.json().error).toMatchObject({ code: 'VALIDATION', message: 'Maksimal 60' });
    const wrongType = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload: { roundingBlockMin: 'x' } });
    expect(wrongType.json().error.message).toBe('Harus berupa angka');
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
