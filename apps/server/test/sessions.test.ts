import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const sim = () => t.sims.get(b.device.id)!;
const start = (payload: Record<string, unknown>) => t.app.inject({ method: 'POST', url: '/api/sessions', headers: { cookie }, payload });
const stop = (id: string) => t.app.inject({ method: 'POST', url: `/api/sessions/${id}/stop`, headers: { cookie }, payload: {} });

describe('mulai sesi', () => {
  it('open billing: sesi RUNNING, bill bernomor, lampu menyala', async () => {
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(200);
    const unit = res.json().unit;
    expect(unit.session).toMatchObject({ mode: 'OPEN', status: 'RUNNING', startedAt: '2026-10-01T03:00:00.000Z', plannedEndAt: null });
    expect(unit.session.segments).toHaveLength(1);
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: unit.session.billId } });
    expect(bill.number).toBe('FP-20261001-0001');
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));

    const second = await start({ unitId: b.m2.id, mode: 'OPEN' });
    const bill2 = await prisma.bill.findUniqueOrThrow({ where: { id: second.json().unit.session.billId } });
    expect(bill2.number).toBe('FP-20261001-0002');
  });

  it('paket: plannedEndAt = mulai + durasi, snapshot harga paket', async () => {
    const res = await start({ unitId: b.m1.id, mode: 'PACKAGE', packageId: b.pkg2.id });
    expect(res.json().unit.session).toMatchObject({
      mode: 'PACKAGE', plannedEndAt: '2026-10-01T05:00:00.000Z', packageName: 'Paket 2 Jam', packageDurationMin: 120, packagePrice: 90000,
    });
  });

  it('meja sedang dipakai → 409 UNIT_BUSY', async () => {
    await start({ unitId: b.m1.id, mode: 'OPEN' });
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('UNIT_BUSY');
  });

  it('concurrent start: dua klik bersamaan hanya membuat satu sesi', async () => {
    const [a, c] = await Promise.all([start({ unitId: b.m1.id, mode: 'OPEN' }), start({ unitId: b.m1.id, mode: 'OPEN' })]);
    expect([a.statusCode, c.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.session.count()).toBe(1);
  });

  it('meja maintenance → 409', async () => {
    await prisma.unit.update({ where: { id: b.m1.id }, data: { state: 'MAINTENANCE' } });
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.json().error.code).toBe('UNIT_MAINTENANCE');
  });

  it('paket untuk tipe lain ditolak, paket wajib diisi', async () => {
    expect((await start({ unitId: b.v1.id, mode: 'PACKAGE', packageId: b.pkg1.id })).json().error.code).toBe('PACKAGE_MISMATCH');
    expect((await start({ unitId: b.m1.id, mode: 'PACKAGE' })).json().error.code).toBe('PACKAGE_REQUIRED');
  });

  it('tanpa tarif pada jam sekarang → 422 NO_TARIFF', async () => {
    await prisma.tariff.deleteMany({ where: { unitTypeId: b.reg.id } });
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('NO_TARIFF');
  });

  it('device offline at start: sesi tetap tercatat, lampu menyala saat device kembali', async () => {
    sim().setOnline(false);
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(200);
    expect(res.json().unit.session.status).toBe('RUNNING');
    expect(sim().snapshot()[0]).toBe(false);
    sim().setOnline(true);
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
  });

  it('memulai sesi menghapus override lampu manual', async () => {
    await prisma.unit.update({ where: { id: b.m1.id }, data: { lightOverride: false } });
    const res = await start({ unitId: b.m1.id, mode: 'OPEN' });
    expect(res.json().unit.lightOverride).toBeNull();
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
  });
});

describe('stop sesi', () => {
  it('menghitung tagihan, mematikan lampu, meja kosong', async () => {
    const s = (await start({ unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(true));
    t.clock.advanceMinutes(100);
    const res = await stop(s.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().charge).toMatchObject({ billableMinutes: 100, chargedMinutes: 105, total: 70000 });
    expect(res.json().unit.session).toBeNull();
    const row = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(row).toMatchObject({ status: 'ENDED', activeUnitId: null, chargeTotal: 70000 });
    expect(row.endedAt?.toISOString()).toBe('2026-10-01T04:40:00.000Z');
    await vi.waitFor(() => expect(sim().snapshot()[0]).toBe(false));
  });

  it('stop dua kali → 409 SESSION_ENDED', async () => {
    const s = (await start({ unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    await stop(s.id);
    const res = await stop(s.id);
    expect(res.json().error.code).toBe('SESSION_ENDED');
  });

  it('meja bisa dipakai lagi setelah stop', async () => {
    const s = (await start({ unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    await stop(s.id);
    expect((await start({ unitId: b.m1.id, mode: 'OPEN' })).statusCode).toBe(200);
  });
});
