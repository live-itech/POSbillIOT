import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  t = await makeApp();
  cookie = await loginAs(t.app, 'owner');
});
afterEach(() => t.app.close());

const post = (url: string, payload: object) => t.app.inject({ method: 'POST', url, headers: { cookie }, payload });

describe('unit types & units', () => {
  it('membuat tipe lalu meja', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    expect(type).toMatchObject({ name: 'Reguler', color: '#7C3AED' });
    const unit = await post('/api/units', { name: 'Meja 1', unitTypeId: type.id });
    expect(unit.statusCode).toBe(200);
    expect(unit.json()).toMatchObject({ name: 'Meja 1', area: '', deviceId: null, relayChannel: null, state: 'ACTIVE', lightOverride: null });
  });

  it('kasir tidak boleh membuat meja', async () => {
    const kasir = await loginAs(t.app, 'kasir');
    const res = await t.app.inject({ method: 'POST', url: '/api/unit-types', headers: { cookie: kasir }, payload: { name: 'X' } });
    expect(res.statusCode).toBe(403);
  });

  it('menolak device tanpa channel dan channel di luar jangkauan', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const device = await prisma.device.create({ data: { name: 'Sim', driver: 'simulator', channels: 4 } });
    const a = await post('/api/units', { name: 'M1', unitTypeId: type.id, deviceId: device.id });
    expect(a.json().error.code).toBe('MAPPING_INCOMPLETE');
    const b = await post('/api/units', { name: 'M1', unitTypeId: type.id, deviceId: device.id, relayChannel: 5 });
    expect(b.json().error.code).toBe('CHANNEL_OUT_OF_RANGE');
  });

  it('channel relay yang sama tidak bisa dipakai dua meja', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const device = await prisma.device.create({ data: { name: 'Sim', driver: 'simulator', channels: 4 } });
    await post('/api/units', { name: 'M1', unitTypeId: type.id, deviceId: device.id, relayChannel: 1 });
    const dup = await post('/api/units', { name: 'M2', unitTypeId: type.id, deviceId: device.id, relayChannel: 1 });
    expect(dup.statusCode).toBe(409);
  });

  it('tipe yang masih dipakai tidak bisa dihapus', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    await post('/api/units', { name: 'M1', unitTypeId: type.id });
    const res = await t.app.inject({ method: 'DELETE', url: `/api/unit-types/${type.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('IN_USE');
  });
});

describe('tariffs & packages', () => {
  it('menyimpan tarif lintas tengah malam dan mengembalikannya dalam HH:MM', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const res = await post('/api/tariffs', { name: 'Malam', unitTypeId: type.id, days: [5, 6], start: '18:00', end: '02:00', pricePerHour: 50000 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Malam', days: [5, 6], start: '18:00', end: '02:00', pricePerHour: 50000, priority: 0, active: true });
    const row = await prisma.tariff.findFirstOrThrow();
    expect(row).toMatchObject({ daysMask: 96, startMin: 1080, endMin: 120 });
  });

  it('end 00:00 disimpan sebagai 24:00', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const res = await post('/api/tariffs', { name: 'Full', unitTypeId: type.id, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00', pricePerHour: 1 });
    expect(res.json().end).toBe('24:00');
  });

  it('menolak jam mulai = jam selesai dan format salah', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const a = await post('/api/tariffs', { name: 'X', unitTypeId: type.id, days: [1], start: '08:00', end: '08:00', pricePerHour: 1 });
    expect(a.json().error.code).toBe('INVALID_TIME');
    const b = await post('/api/tariffs', { name: 'X', unitTypeId: type.id, days: [1], start: '8:00', end: '09:00', pricePerHour: 1 });
    expect(b.statusCode).toBe(400);
  });

  it('PATCH tarif hanya jam mulai tetap memakai jam selesai lama', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const tr = (await post('/api/tariffs', { name: 'Siang', unitTypeId: type.id, days: [1], start: '08:00', end: '18:00', pricePerHour: 1 })).json();
    const res = await t.app.inject({ method: 'PATCH', url: `/api/tariffs/${tr.id}`, headers: { cookie }, payload: { start: '09:00' } });
    expect(res.json()).toMatchObject({ start: '09:00', end: '18:00' });
  });

  it('CRUD paket', async () => {
    const type = (await post('/api/unit-types', { name: 'Reguler' })).json();
    const p = (await post('/api/packages', { name: 'Paket 2 Jam', unitTypeId: type.id, durationMin: 120, price: 90000 })).json();
    expect(p).toMatchObject({ name: 'Paket 2 Jam', durationMin: 120, price: 90000, active: true });
    const del = await t.app.inject({ method: 'DELETE', url: `/api/packages/${p.id}`, headers: { cookie } });
    expect(del.statusCode).toBe(204);
  });
});
