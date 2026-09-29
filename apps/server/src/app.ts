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
import { DeviceManager } from './modules/devices/device-manager';
import { devicesRoutes } from './modules/devices/devices.routes';
import { createDefaultDriverFactory, type DriverFactory } from './modules/devices/driver';
import { sessionsRoutes } from './modules/sessions/sessions.routes';
import { SessionService } from './modules/sessions/sessions.service';
import { settingsRoutes } from './modules/settings/settings.routes';
import { usersRoutes } from './modules/users/users.routes';

export interface BuildAppDeps {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  driverFactory?: DriverFactory;
  /** false di test: loop rekonsiliasi & scheduler tidak dijalankan otomatis. */
  startLoops?: boolean;
}

export async function buildApp(deps: BuildAppDeps) {
  const startLoops = deps.startLoops ?? true;
  const app = Fastify({ logger: deps.config.NODE_ENV === 'test' ? false : { level: 'info' } });
  const bus = new Bus();
  const devices = new DeviceManager({
    prisma: deps.prisma,
    clock: deps.clock,
    bus,
    driverFactory: deps.driverFactory ?? createDefaultDriverFactory(),
    log: app.log,
  });
  const ctx = { prisma: deps.prisma, clock: deps.clock, config: deps.config, bus, devices } as AppContext;
  ctx.sessions = new SessionService(ctx);

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
      await api.register(devicesRoutes(ctx));
      await api.register(sessionsRoutes(ctx));
    },
    { prefix: '/api' },
  );

  await devices.start({ loop: startLoops });
  app.addHook('onClose', async () => {
    await devices.stop();
  });

  return { app, ctx };
}
