import type { Role } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { FakeClock } from '../src/lib/clock';
import { hashSecret } from '../src/modules/auth/password';
import type { DriverFactory } from '../src/modules/devices/driver';
import { SimulatorDriver } from '../src/modules/devices/simulator.driver';

export const prisma = new PrismaClient();

/** Kamis 1 Okt 2026 10:00 WIB. */
export const T0 = new Date('2026-10-01T03:00:00Z');

export async function resetDb(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

export async function makeApp(opts: { now?: Date; configure?: (app: FastifyInstance) => void } = {}) {
  const clock = new FakeClock(opts.now ?? T0);
  const sims = new Map<string, SimulatorDriver>();
  const driverFactory: DriverFactory = (row) => {
    const s = new SimulatorDriver(row.channels);
    sims.set(row.id, s);
    return s;
  };
  const { app, ctx } = await buildApp({ prisma, clock, config: loadConfig(), driverFactory, startLoops: false });
  opts.configure?.(app);
  await app.ready();
  await ctx.devices.reconcileAll();
  return { app, ctx, clock, sims };
}

export async function createUser(role: Role, username = role.toLowerCase(), opts: { password?: string; pin?: string } = {}) {
  return prisma.user.create({
    data: {
      name: username,
      username,
      role,
      passwordHash: await hashSecret(opts.password ?? 'secret123'),
      pinHash: opts.pin ? await hashSecret(opts.pin) : null,
    },
  });
}

export async function seedUsers() {
  const kasir = await createUser('KASIR');
  const supervisor = await createUser('SUPERVISOR', 'supervisor', { pin: '1111' });
  const owner = await createUser('OWNER', 'owner', { pin: '1234' });
  return { kasir, supervisor, owner };
}

export async function loginAs(app: FastifyInstance, username: string, password = 'secret123'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  if (res.statusCode !== 200) throw new Error(`login ${username} gagal: ${res.body}`);
  const c = res.cookies.find((x) => x.name === 'fp_session');
  if (!c) throw new Error('cookie tidak ada');
  return `fp_session=${c.value}`;
}

export async function seedBasics() {
  await prisma.setting.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  const reg = await prisma.unitType.create({ data: { name: 'Reguler' } });
  const vip = await prisma.unitType.create({ data: { name: 'VIP' } });
  const device = await prisma.device.create({ data: { name: 'Sim A', driver: 'simulator', channels: 4 } });
  const m1 = await prisma.unit.create({ data: { name: 'Meja 1', unitTypeId: reg.id, deviceId: device.id, relayChannel: 1, sortOrder: 1 } });
  const m2 = await prisma.unit.create({ data: { name: 'Meja 2', unitTypeId: reg.id, deviceId: device.id, relayChannel: 2, sortOrder: 2 } });
  const v1 = await prisma.unit.create({ data: { name: 'VIP 1', unitTypeId: vip.id, deviceId: device.id, relayChannel: 3, sortOrder: 3 } });
  await prisma.tariff.createMany({
    data: [
      { name: 'Reguler Siang', unitTypeId: reg.id, startMin: 480, endMin: 1080, pricePerHour: 40000 },
      { name: 'Reguler Malam', unitTypeId: reg.id, startMin: 1080, endMin: 480, pricePerHour: 50000 },
      { name: 'VIP', unitTypeId: vip.id, startMin: 0, endMin: 1440, pricePerHour: 80000 },
    ],
  });
  const pkg1 = await prisma.package.create({ data: { name: 'Paket 1 Jam', unitTypeId: reg.id, durationMin: 60, price: 45000 } });
  const pkg2 = await prisma.package.create({ data: { name: 'Paket 2 Jam', unitTypeId: reg.id, durationMin: 120, price: 90000 } });
  return { reg, vip, device, m1, m2, v1, pkg1, pkg2 };
}
