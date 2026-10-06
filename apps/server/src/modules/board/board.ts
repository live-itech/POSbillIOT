import { Prisma } from '@prisma/client';
import { addMinutes, type BoardSnapshot, type SessionView, type UnitBookingView, type UnitView } from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
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

/** Booking BOOKED yang sedang di-hold per meja (yang terawal), plus status DP. */
export async function holdBookings(db: Db, now: Date, holdMin: number, unitIds?: string[]): Promise<Map<string, UnitBookingView>> {
  const rows = await db.booking.findMany({
    where: { status: 'BOOKED', startAt: { lte: addMinutes(now, holdMin) }, ...(unitIds ? { unitId: { in: unitIds } } : {}) },
    orderBy: { startAt: 'asc' },
  });
  const depIds = rows.map((r) => r.depositBillId).filter((x): x is string => !!x);
  const paid = new Set(
    (depIds.length ? await db.bill.findMany({ where: { id: { in: depIds }, status: 'PAID' }, select: { id: true } }) : []).map((x) => x.id),
  );
  const out = new Map<string, UnitBookingView>();
  for (const r of rows) {
    if (out.has(r.unitId)) continue;
    out.set(r.unitId, {
      id: r.id, customerName: r.customerName, startAt: r.startAt.toISOString(), durationMin: r.durationMin,
      depositPaid: !!r.depositBillId && paid.has(r.depositBillId),
    });
  }
  return out;
}

export function toUnitView(u: UnitRow, devices: DeviceManager, booking: UnitBookingView | null = null): UnitView {
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
    booking,
  };
}

export async function buildUnitView(ctx: AppContext, unitId: string): Promise<UnitView | null> {
  const [u, settings] = await Promise.all([ctx.prisma.unit.findUnique({ where: { id: unitId }, include: unitInclude }), getSettings(ctx.prisma)]);
  if (!u) return null;
  const holds = await holdBookings(ctx.prisma, ctx.clock.now(), settings.bookingHoldMin, [u.id]);
  return toUnitView(u, ctx.devices, holds.get(u.id) ?? null);
}

export async function buildBoard(ctx: AppContext): Promise<BoardSnapshot> {
  const [settings, units, tariffs] = await Promise.all([
    getSettings(ctx.prisma),
    ctx.prisma.unit.findMany({ include: unitInclude, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    loadTariffRules(ctx.prisma),
  ]);
  const holds = await holdBookings(ctx.prisma, ctx.clock.now(), settings.bookingHoldMin);
  return {
    serverTime: ctx.clock.now().toISOString(),
    settings,
    units: units.map((u) => toUnitView(u, ctx.devices, holds.get(u.id) ?? null)),
    devices: ctx.devices.status(),
    tariffs,
  };
}
