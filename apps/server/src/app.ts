import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';
import type { Config } from './config';
import type { AppContext } from './context';
import { Bus } from './lib/bus';
import type { Clock } from './lib/clock';
import { BillService } from './modules/billing/bills.service';
import { billsRoutes } from './modules/billing/bills.routes';
import { registerErrorHandler } from './lib/errors';
import { authRoutes } from './modules/auth/auth.routes';
import { installAuth } from './modules/auth/guard';
import { packagesRoutes } from './modules/catalog/packages.routes';
import { categoriesRoutes } from './modules/catalog/categories.routes';
import { productsRoutes } from './modules/catalog/products.routes';
import { tariffsRoutes } from './modules/catalog/tariffs.routes';
import { unitTypesRoutes } from './modules/catalog/unit-types.routes';
import { unitsRoutes } from './modules/catalog/units.routes';
import { DeviceManager } from './modules/devices/device-manager';
import { devicesRoutes } from './modules/devices/devices.routes';
import { createDefaultDriverFactory, type DriverFactory } from './modules/devices/driver';
import { attachRealtime } from './modules/realtime/realtime';
import { Scheduler } from './modules/scheduler/scheduler';
import { sessionsRoutes } from './modules/sessions/sessions.routes';
import { SessionService } from './modules/sessions/sessions.service';
import { shiftsRoutes } from './modules/shifts/shifts.routes';
import { ShiftService } from './modules/shifts/shifts.service';
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
  ctx.shifts = new ShiftService(ctx);
  ctx.bills = new BillService(ctx);
  ctx.scheduler = new Scheduler(ctx);

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
      await api.register(categoriesRoutes(ctx));
      await api.register(productsRoutes(ctx));
      await api.register(devicesRoutes(ctx));
      await api.register(sessionsRoutes(ctx));
      await api.register(shiftsRoutes(ctx));
      await api.register(billsRoutes(ctx));
    },
    { prefix: '/api' },
  );

  if (deps.config.WEB_DIST) {
    await app.register(fastifyStatic, { root: deps.config.WEB_DIST, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (!deps.config.WEB_DIST || req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Tidak ditemukan' } });
    }
    return reply.sendFile('index.html');
  });

  attachRealtime(app, ctx);

  await devices.start({ loop: startLoops });
  if (startLoops) {
    await ctx.scheduler.tick(); // pemulihan: expire paket yang lewat selama server mati
    ctx.scheduler.start();
  }
  app.addHook('onClose', async () => {
    ctx.scheduler.stop();
    await devices.stop();
  });

  return { app, ctx };
}
