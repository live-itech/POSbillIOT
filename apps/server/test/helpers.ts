import type { Role } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { FakeClock } from '../src/lib/clock';
import { hashSecret } from '../src/modules/auth/password';

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
  const { app, ctx } = await buildApp({ prisma, clock, config: loadConfig(), startLoops: false });
  opts.configure?.(app);
  await app.ready();
  return { app, ctx, clock };
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
