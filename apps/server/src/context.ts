import type { PrismaClient } from '@prisma/client';
import type { Config } from './config';
import type { Bus } from './lib/bus';
import type { Clock } from './lib/clock';

export interface AppContext {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  bus: Bus;
}
