import type { Device, PrismaClient } from '@prisma/client';
import type { DeviceStatusView } from '@funplay/shared';
import { emitAlert } from '../../lib/alerts';
import type { Bus } from '../../lib/bus';
import type { Clock } from '../../lib/clock';
import { withTimeout } from '../../lib/timeout';
import { getSettings } from '../settings/settings.service';
import { desiredLight } from './desired';
import type { DeviceConfigRow, DeviceDriver, DriverFactory } from './driver';

export const RECONCILE_INTERVAL_MS = 10_000;
export const COMMAND_TIMEOUT_MS = 3_000;

export interface DeviceManagerDeps {
  prisma: PrismaClient;
  clock: Clock;
  bus: Bus;
  driverFactory: DriverFactory;
  log: { warn: (obj: unknown, msg?: string) => void };
}

interface Entry {
  row: DeviceConfigRow;
  driver: DeviceDriver;
  actual: boolean[] | null;
  /** Nilai terakhir yang berhasil di-ACK / dikonfirmasi per channel. */
  acked: Map<number, boolean>;
  alertedUnexpected: Set<number>;
  wasOnline: boolean;
  queue: Promise<void>;
}

interface ChannelPlan {
  channel: number;
  on: boolean;
  unitId: string | null;
  unitName: string | null;
}

const toRow = (d: Device): DeviceConfigRow => ({
  id: d.id, name: d.name, driver: d.driver, channels: d.channels, host: d.host, port: d.port, codec: d.codec, config: d.config,
});

export class DeviceManager {
  private entries = new Map<string, Entry>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: DeviceManagerDeps) {
    deps.bus.on('board.changed', () => void this.reconcileAll());
  }

  async start(opts: { loop: boolean }): Promise<void> {
    const rows = await this.deps.prisma.device.findMany();
    for (const row of rows) await this.attach(toRow(row));
    if (opts.loop) this.timer = setInterval(() => void this.reconcileAll(), RECONCILE_INTERVAL_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const id of [...this.entries.keys()]) await this.detach(id);
  }

  async reload(deviceId: string): Promise<void> {
    await this.detach(deviceId);
    const row = await this.deps.prisma.device.findUnique({ where: { id: deviceId } });
    if (row) await this.attach(toRow(row));
    this.deps.bus.emit('board.changed');
  }

  getDriver(deviceId: string): DeviceDriver | undefined {
    return this.entries.get(deviceId)?.driver;
  }

  status(): DeviceStatusView[] {
    return [...this.entries.values()].map((e) => this.view(e));
  }

  light(deviceId: string | null, channel: number | null): boolean | null {
    if (!deviceId || channel === null) return null;
    const e = this.entries.get(deviceId);
    if (!e || !e.driver.isOnline()) return null;
    return e.actual?.[channel - 1] ?? e.acked.get(channel) ?? null;
  }

  online(deviceId: string | null): boolean | null {
    if (!deviceId) return null;
    return this.entries.get(deviceId)?.driver.isOnline() ?? false;
  }

  async applyUnit(unitId: string): Promise<void> {
    const unit = await this.deps.prisma.unit.findUnique({ where: { id: unitId }, select: { deviceId: true } });
    if (unit?.deviceId) await this.reconcile(unit.deviceId);
  }

  async reconcileAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((id) => this.reconcile(id)));
  }

  reconcile(deviceId: string): Promise<void> {
    const e = this.entries.get(deviceId);
    if (!e) return Promise.resolve();
    e.queue = e.queue.then(() => this.doReconcile(e)).catch((err: unknown) => this.deps.log.warn({ err }, 'rekonsiliasi device gagal'));
    return e.queue;
  }

  // ---------- internal ----------

  private async attach(row: DeviceConfigRow): Promise<void> {
    let driver: DeviceDriver;
    try {
      driver = this.deps.driverFactory(row);
    } catch (err) {
      this.deps.log.warn({ err, device: row.name }, 'driver device tidak bisa dibuat');
      return;
    }
    const entry: Entry = { row, driver, actual: null, acked: new Map(), alertedUnexpected: new Set(), wasOnline: false, queue: Promise.resolve() };
    this.entries.set(row.id, entry);
    await this.deps.prisma.device.update({ where: { id: row.id }, data: { online: false } });
    // Handler async dipanggil tanpa await; tangkap error agar tidak jadi unhandled rejection.
    const safe = (p: Promise<void>) => p.catch((err: unknown) => this.deps.log.warn({ err, device: row.name }, 'event device gagal diproses'));
    // driver.start() bisa memicu 'online' secara sinkron (mis. SimulatorDriver). Tangkap promise-nya
    // di sini agar attach() ikut menunggunya selesai — tanpa ini, onOnline() (termasuk reconcile()
    // internalnya) masih berjalan di latar belakang saat start()/reconcileAll() sudah resolve, dan bisa
    // balapan dengan pemanggil (mis. mengonsumsi SimulatorDriver.failNext pada percobaan yang tidak
    // diharapkan test).
    let initialOnline: Promise<void> | null = null;
    driver.on('online', () => {
      initialOnline = safe(this.onOnline(entry));
    });
    driver.on('offline', () => void safe(this.onOffline(entry)));
    driver.on('state', (relays) => void safe(this.onState(entry, relays)));
    try {
      await driver.start();
    } catch (err) {
      this.deps.log.warn({ err, device: row.name }, 'device gagal start');
    }
    if (initialOnline) await initialOnline;
  }

  private async detach(deviceId: string): Promise<void> {
    const e = this.entries.get(deviceId);
    if (!e) return;
    this.entries.delete(deviceId);
    e.driver.removeAllListeners();
    await e.driver.stop().catch(() => undefined);
  }

  private view(e: Entry): DeviceStatusView {
    return {
      id: e.row.id, name: e.row.name, driver: e.row.driver, channels: e.row.channels,
      online: e.driver.isOnline(), relays: e.actual ? [...e.actual] : null, lastSeenAt: null,
    };
  }

  private async changed(e: Entry): Promise<void> {
    this.deps.bus.emit('device.changed', this.view(e));
    const units = await this.deps.prisma.unit.findMany({ where: { deviceId: e.row.id }, select: { id: true } });
    for (const u of units) this.deps.bus.emit('unit.changed', u.id);
  }

  private async onOnline(e: Entry): Promise<void> {
    e.acked.clear();
    const { prisma, bus, clock } = this.deps;
    await prisma.device.update({ where: { id: e.row.id }, data: { online: true, lastSeenAt: clock.now() } });
    await prisma.deviceEvent.create({ data: { deviceId: e.row.id, type: 'ONLINE' } });
    if (e.wasOnline) emitAlert(bus, clock, { level: 'info', type: 'DEVICE_ONLINE', unitId: null, message: `Device ${e.row.name} tersambung kembali` });
    e.wasOnline = true;
    await this.reconcile(e.row.id);
    await this.changed(e);
  }

  private async onOffline(e: Entry): Promise<void> {
    e.actual = null;
    const { prisma, bus, clock } = this.deps;
    await prisma.device.update({ where: { id: e.row.id }, data: { online: false } });
    await prisma.deviceEvent.create({ data: { deviceId: e.row.id, type: 'OFFLINE' } });
    emitAlert(bus, clock, { level: 'danger', type: 'DEVICE_OFFLINE', unitId: null, message: `Device ${e.row.name} terputus` });
    await this.changed(e);
  }

  private async onState(e: Entry, relays: boolean[]): Promise<void> {
    e.actual = relays;
    await this.deps.prisma.device.update({ where: { id: e.row.id }, data: { lastSeenAt: this.deps.clock.now() } });
    await this.reconcile(e.row.id);
    await this.changed(e);
  }

  private async plan(deviceId: string, channels: number, pauseKeepsLightOn: boolean): Promise<ChannelPlan[]> {
    const units = await this.deps.prisma.unit.findMany({
      where: { deviceId },
      select: { id: true, name: true, relayChannel: true, lightOverride: true, activeSession: { select: { status: true } } },
    });
    const plans: ChannelPlan[] = [];
    for (let ch = 1; ch <= channels; ch++) {
      const u = units.find((x) => x.relayChannel === ch);
      plans.push({
        channel: ch,
        unitId: u?.id ?? null,
        unitName: u?.name ?? null,
        on: u ? desiredLight(u.lightOverride, u.activeSession?.status ?? null, pauseKeepsLightOn) : false,
      });
    }
    return plans;
  }

  private async doReconcile(e: Entry): Promise<void> {
    if (!e.driver.isOnline()) return;
    if (e.driver.readAll) {
      try {
        e.actual = await withTimeout(e.driver.readAll(), COMMAND_TIMEOUT_MS);
      } catch {
        // pakai state terakhir yang diketahui
      }
    }
    const settings = await getSettings(this.deps.prisma);
    const plans = await this.plan(e.row.id, e.row.channels, settings.pauseKeepsLightOn);
    for (const p of plans) {
      const cur = e.actual ? (e.actual[p.channel - 1] ?? null) : null;
      if (cur === p.on) {
        e.acked.set(p.channel, cur);
        e.alertedUnexpected.delete(p.channel);
        continue;
      }
      if (cur === null && e.acked.get(p.channel) === p.on) continue;
      if (cur === true && !p.on && e.acked.get(p.channel) === false) {
        await this.flagUnexpected(e, p);
        if (!settings.autoOffUnexpected) continue;
      }
      await this.send(e, p);
    }
  }

  private async flagUnexpected(e: Entry, p: ChannelPlan): Promise<void> {
    if (e.alertedUnexpected.has(p.channel)) return;
    e.alertedUnexpected.add(p.channel);
    await this.deps.prisma.deviceEvent.create({ data: { deviceId: e.row.id, channel: p.channel, type: 'UNEXPECTED_ON' } });
    emitAlert(this.deps.bus, this.deps.clock, {
      level: 'danger',
      type: 'UNEXPECTED_ON',
      unitId: p.unitId,
      message: `${p.unitName ?? `Channel ${p.channel}`}: lampu menyala tanpa sesi`,
    });
  }

  private async send(e: Entry, p: ChannelPlan): Promise<void> {
    const { prisma, bus, clock } = this.deps;
    await prisma.deviceEvent.create({ data: { deviceId: e.row.id, channel: p.channel, type: p.on ? 'CMD_ON' : 'CMD_OFF' } });
    try {
      await withTimeout(e.driver.setRelay(p.channel, p.on), COMMAND_TIMEOUT_MS);
      e.acked.set(p.channel, p.on);
      if (e.actual) e.actual[p.channel - 1] = p.on;
      await prisma.deviceEvent.create({ data: { deviceId: e.row.id, channel: p.channel, type: 'ACK' } });
    } catch (err) {
      await prisma.deviceEvent.create({ data: { deviceId: e.row.id, channel: p.channel, type: 'FAIL', detail: { on: p.on, error: String(err) } } });
      emitAlert(bus, clock, {
        level: 'warning',
        type: 'DEVICE_CMD_FAILED',
        unitId: p.unitId,
        message: `Lampu ${p.unitName ?? `channel ${p.channel}`} belum merespons`,
      });
    }
  }
}
