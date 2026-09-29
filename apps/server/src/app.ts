import cookie from '@fastify/cookie';
import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import type { Config } from './config';
import type { AppContext } from './context';
import { Bus } from './lib/bus';
import type { Clock } from './lib/clock';
import { registerErrorHandler } from './lib/errors';
import { authRoutes } from './modules/auth/auth.routes';
import { installAuth } from './modules/auth/guard';
import { packagesRoutes } from './modules/catalog/packages.routes';
import { tariffsRoutes } from './modules/catalog/tariffs.routes';
import { unitTypesRoutes } from './modules/catalog/unit-types.routes';
import { unitsRoutes } from './modules/catalog/units.routes';
import { settingsRoutes } from './modules/settings/settings.routes';
import { usersRoutes } from './modules/users/users.routes';

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
  installAuth(app, ctx);

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true, serverTime: ctx.clock.now().toISOString() }));
      await api.register(authRoutes(ctx));
      await api.register(settingsRoutes(ctx));
      await api.register(usersRoutes(ctx));
      await api.register(unitTypesRoutes(ctx));
      await api.register(unitsRoutes(ctx));
      await api.register(tariffsRoutes(ctx));
      await api.register(packagesRoutes(ctx));
    },
    { prefix: '/api' },
  );

  return { app, ctx };
}
