import type { PrismaClient } from '@prisma/client';
import type { Config } from './config';
import type { Bus } from './lib/bus';
import type { Clock } from './lib/clock';
import type { DeviceManager } from './modules/devices/device-manager';
import type { Scheduler } from './modules/scheduler/scheduler';
import type { SessionService } from './modules/sessions/sessions.service';

export interface AppContext {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  bus: Bus;
  devices: DeviceManager;
  sessions: SessionService;
  scheduler: Scheduler;
}
