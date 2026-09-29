import type { AlertEvent } from '@funplay/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bus } from '../src/lib/bus';
import { FakeClock } from '../src/lib/clock';
import { desiredLight } from '../src/modules/devices/desired';
import { DeviceManager } from '../src/modules/devices/device-manager';
import { SimulatorDriver } from '../src/modules/devices/simulator.driver';
import { prisma, resetDb, seedBasics, T0 } from './helpers';

describe('desiredLight', () => {
  it('override menang atas sesi', () => {
    expect(desiredLight(true, null, true)).toBe(true);
    expect(desiredLight(false, 'RUNNING', true)).toBe(false);
  });
  it('mengikuti status sesi', () => {
    expect(desiredLight(null, 'RUNNING', true)).toBe(true);
    expect(desiredLight(null, 'PAUSED', true)).toBe(true);
    expect(desiredLight(null, 'PAUSED', false)).toBe(false);
    expect(desiredLight(null, 'EXPIRED', true)).toBe(false);
    expect(desiredLight(null, null, true)).toBe(false);
  });
});

describe('DeviceManager', () => {
  let bus: Bus;
  let manager: DeviceManager;
  let sim: SimulatorDriver;
  let alerts: AlertEvent[];
  let basics: Awaited<ReturnType<typeof seedBasics>>;

  beforeEach(async () => {
    await resetDb();
    basics = await seedBasics();
    bus = new Bus();
    alerts = [];
    bus.on('alert', (a) => alerts.push(a));
    manager = new DeviceManager({
      prisma,
      clock: new FakeClock(T0),
      bus,
      driverFactory: (row) => (sim = new SimulatorDriver(row.channels)),
      log: { warn: () => {} },
    });
    await manager.start({ loop: false });
    await manager.reconcileAll();
  });
  afterEach(() => manager.stop());

  it('menandai device online di DB saat start', async () => {
    await vi.waitFor(async () => {
      expect((await prisma.device.findUniqueOrThrow({ where: { id: basics.device.id } })).online).toBe(true);
      expect(await prisma.deviceEvent.count({ where: { type: 'ONLINE' } })).toBe(1);
    });
    expect(manager.status()[0]).toMatchObject({ id: basics.device.id, online: true, relays: [false, false, false, false] });
  });

  it('applyUnit menyalakan relay sesuai override dan mencatat CMD_ON + ACK', async () => {
    await prisma.unit.update({ where: { id: basics.m1.id }, data: { lightOverride: true } });
    await manager.applyUnit(basics.m1.id);
    expect(sim.snapshot()).toEqual([true, false, false, false]);
    expect(manager.light(basics.device.id, 1)).toBe(true);
    const types = (await prisma.deviceEvent.findMany({ where: { channel: 1 } })).map((e) => e.type).sort();
    expect(types).toEqual(['ACK', 'CMD_ON']);
  });

  it('device offline → alert DEVICE_OFFLINE dan DB online=false', async () => {
    sim.setOnline(false);
    await vi.waitFor(() => expect(alerts.map((a) => a.type)).toContain('DEVICE_OFFLINE'));
    await vi.waitFor(async () => expect((await prisma.device.findUniqueOrThrow({ where: { id: basics.device.id } })).online).toBe(false));
  });

  it('saat tersambung kembali, state yang benar dikirim ulang', async () => {
    sim.powerCycle();
    await prisma.unit.update({ where: { id: basics.m1.id }, data: { lightOverride: true } });
    await manager.applyUnit(basics.m1.id);
    expect(sim.snapshot()[0]).toBe(false);
    sim.setOnline(true);
    await vi.waitFor(() => expect(sim.snapshot()[0]).toBe(true));
    expect(alerts.map((a) => a.type)).toContain('DEVICE_ONLINE');
  });

  it('relay dinyalakan manual tanpa sesi → UNEXPECTED_ON, tidak dimatikan bila autoOff=false', async () => {
    sim.physicalSet(2, true);
    await vi.waitFor(() => expect(alerts.map((a) => a.type)).toContain('UNEXPECTED_ON'));
    expect(alerts.find((a) => a.type === 'UNEXPECTED_ON')).toMatchObject({ unitId: basics.m2.id, level: 'danger' });
    expect(sim.snapshot()[1]).toBe(true);
    expect(await prisma.deviceEvent.count({ where: { type: 'UNEXPECTED_ON' } })).toBe(1);

    await prisma.setting.update({ where: { id: 1 }, data: { autoOffUnexpected: true } });
    await manager.reconcileAll();
    expect(sim.snapshot()[1]).toBe(false);
  });

  it('perintah gagal → FAIL + alert, lalu berhasil di rekonsiliasi berikutnya', async () => {
    sim.failNext = 1;
    await prisma.unit.update({ where: { id: basics.m1.id }, data: { lightOverride: true } });
    await manager.applyUnit(basics.m1.id);
    expect(sim.snapshot()[0]).toBe(false);
    expect(alerts.map((a) => a.type)).toContain('DEVICE_CMD_FAILED');
    expect(await prisma.deviceEvent.count({ where: { type: 'FAIL' } })).toBe(1);
    await manager.reconcileAll();
    expect(sim.snapshot()[0]).toBe(true);
  });

  it('board.changed memicu rekonsiliasi', async () => {
    await prisma.unit.update({ where: { id: basics.v1.id }, data: { lightOverride: true } });
    bus.emit('board.changed');
    await vi.waitFor(() => expect(sim.snapshot()[2]).toBe(true));
  });
});
