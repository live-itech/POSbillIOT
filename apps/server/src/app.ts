import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import type { Config } from './config';
import type { AppContext } from './context';
import { Bus } from './lib/bus';
import type { Clock } from './lib/clock';
import { registerErrorHandler } from './lib/errors';

export interface BuildAppDeps {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  /** false di test: loop rekonsiliasi & scheduler tidak dijalankan otomatis. */
  startLoops?: boolean;
}

export async function buildApp(deps: BuildAppDeps) {
  const app = Fastify({ logger: deps.config.NODE_ENV === 'test' ? false : { level: 'info' } });
  const ctx: AppContext = { prisma: deps.prisma, clock: deps.clock, config: deps.config, bus: new Bus() };

  registerErrorHandler(app);
  await app.register(cookie, { secret: deps.config.COOKIE_SECRET });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, serverTime: ctx.clock.now().toISOString() }));
    },
    { prefix: '/api' },
  );

  return { app, ctx };
}
