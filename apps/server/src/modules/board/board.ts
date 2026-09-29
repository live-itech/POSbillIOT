import { Prisma } from '@prisma/client';
import type { BoardSnapshot, SessionView, UnitView } from '@funplay/shared';
import type { AppContext } from '../../context';
import { loadTariffRules } from '../catalog/tariffs.service';
import type { DeviceManager } from '../devices/device-manager';
import { getSettings } from '../settings/settings.service';

export const unitInclude = Prisma.validator<Prisma.UnitInclude>()({
  unitType: true,
  activeSession: {
    include: {
      segments: { orderBy: { startedAt: 'asc' } },
      pauses: { orderBy: { pausedAt: 'asc' } },
    },
  },
});

type UnitRow = Prisma.UnitGetPayload<{ include: typeof unitInclude }>;
type SessionRow = NonNullable<UnitRow['activeSession']>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toSessionView(s: SessionRow): SessionView {
  return {
    id: s.id,
    billId: s.billId,
    mode: s.mode,
    status: s.status,
    startedAt: s.startedAt.toISOString(),
    plannedEndAt: iso(s.plannedEndAt),
    endedAt: iso(s.endedAt),
    packageName: s.packageName,
    packageDurationMin: s.packageDurationMin,
    packagePrice: s.packagePrice,
    segments: s.segments.map((g) => ({ unitId: g.unitId, unitTypeId: g.unitTypeId, startedAt: g.startedAt.toISOString(), endedAt: iso(g.endedAt) })),
    pauses: s.pauses.map((p) => ({ pausedAt: p.pausedAt.toISOString(), resumedAt: iso(p.resumedAt) })),
  };
}

export function toUnitView(u: UnitRow, devices: DeviceManager): UnitView {
  return {
    id: u.id,
    name: u.name,
    unitTypeId: u.unitTypeId,
    unitTypeName: u.unitType.name,
    unitTypeColor: u.unitType.color,
    area: u.area,
    deviceId: u.deviceId,
    relayChannel: u.relayChannel,
    state: u.state,
    sortOrder: u.sortOrder,
    lightOverride: u.lightOverride,
    light: devices.light(u.deviceId, u.relayChannel),
    deviceOnline: devices.online(u.deviceId),
    session: u.activeSession ? toSessionView(u.activeSession) : null,
  };
}

export async function buildUnitView(ctx: AppContext, unitId: string): Promise<UnitView | null> {
  const u = await ctx.prisma.unit.findUnique({ where: { id: unitId }, include: unitInclude });
  return u ? toUnitView(u, ctx.devices) : null;
}

export async function buildBoard(ctx: AppContext): Promise<BoardSnapshot> {
  const [settings, units, tariffs] = await Promise.all([
    getSettings(ctx.prisma),
    ctx.prisma.unit.findMany({ include: unitInclude, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    loadTariffRules(ctx.prisma),
  ]);
  return {
    serverTime: ctx.clock.now().toISOString(),
    settings,
    units: units.map((u) => toUnitView(u, ctx.devices)),
    devices: ctx.devices.status(),
    tariffs,
  };
}
