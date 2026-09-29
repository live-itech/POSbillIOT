import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { FakeClock } from '../src/lib/clock';

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
