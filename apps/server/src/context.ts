import type { PrismaClient } from '@prisma/client';
import type { Config } from './config';
import type { Bus } from './lib/bus';
import type { Clock } from './lib/clock';
import type { DeviceManager } from './modules/devices/device-manager';
import type { Scheduler } from './modules/scheduler/scheduler';
import type { BillService } from './modules/billing/bills.service';
import type { CheckoutService } from './modules/billing/checkout.service';
import type { PrintService } from './modules/printing/print.service';
import type { SessionService } from './modules/sessions/sessions.service';
import type { ShiftService } from './modules/shifts/shifts.service';

export interface AppContext {
  prisma: PrismaClient;
  clock: Clock;
  config: Config;
  bus: Bus;
  devices: DeviceManager;
  sessions: SessionService;
  shifts: ShiftService;
  bills: BillService;
  checkout: CheckoutService;
  printing: PrintService;
  scheduler: Scheduler;
}
