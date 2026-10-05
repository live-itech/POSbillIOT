import { Prisma, type Session } from '@prisma/client';
import {
  addMinutes, computeSessionCharge, findTariff, localDateKey, NoTariffError, sessionElapsedMs,
  type ChargeSettings, type PublicUser, type SessionLike, type SessionMode, type TariffRule, type TimeCharge,
} from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { loadTariffRules } from '../catalog/tariffs.service';
import { requireOpenShift } from '../shifts/shifts.service';
import { getSettings } from '../settings/settings.service';

export async function nextBillNumber(tx: Db, now: Date, utcOffsetMin: number): Promise<string> {
  const date = localDateKey(now, utcOffsetMin);
  const c = await tx.billCounter.upsert({ where: { date }, create: { date, last: 1 }, update: { last: { increment: 1 } } });
  return `FP-${date}-${String(c.last).padStart(4, '0')}`;
}

/** Ubah pelanggaran unik `activeUnitId` (race dua kasir) menjadi 409 UNIT_BUSY. */
export function rethrowBusy(err: unknown, unitName: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target ?? '').includes('activeUnitId')) {
    throw conflict('UNIT_BUSY', `${unitName} sedang dipakai`);
  }
  throw err;
}

/** Kunci baris sesi (SELECT ... FOR UPDATE) agar mutasi bersamaan berjalan berurutan. */
async function lockSession(tx: Db, sessionId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;
}

/**
 * Tagihan waktu untuk stop. Stop tidak boleh pernah gagal karena tarif: menit di luar cakupan tarif
 * sudah dihargai kalkulator dengan tarif terdekat (`fallback`). Hanya bila tipe meja sama sekali tidak
 * punya tarif, tagihan waktu menjadi 0 dan ditandai `noTariff`.
 */
export function stopCharge(s: SessionLike, rules: TariffRule[], settings: ChargeSettings, endAt: Date): TimeCharge {
  try {
    return computeSessionCharge(s, rules, settings, endAt);
  } catch (err) {
    if (!(err instanceof NoTariffError)) throw err;
    const billableMinutes = Math.ceil(sessionElapsedMs(s, endAt) / 60_000);
    return { billableMinutes, chargedMinutes: 0, total: 0, lines: [], noTariff: true };
  }
}

export const sessionParts = { segments: { orderBy: { startedAt: 'asc' } }, pauses: { orderBy: { pausedAt: 'asc' } } } satisfies Prisma.SessionInclude;

export class SessionService {
  constructor(protected readonly ctx: AppContext) {}

  /** Setelah commit: rekonsiliasi lampu (tanpa menunggu) dan beri tahu klien. */
  protected touch(...unitIds: string[]): void {
    for (const id of unitIds) {
      void this.ctx.devices.applyUnit(id);
      this.ctx.bus.emit('unit.changed', id);
    }
  }

  async start(user: PublicUser, input: { unitId: string; mode: SessionMode; packageId?: string }): Promise<Session> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const unitName = (await prisma.unit.findUnique({ where: { id: input.unitId }, select: { name: true } }))?.name ?? 'Meja';

    let session: Session;
    try {
      session = await prisma.$transaction(async (tx) => {
        await requireOpenShift(tx);
        const unit = await tx.unit.findUnique({ where: { id: input.unitId }, include: { activeSession: true } });
        if (!unit) throw notFound('Meja');
        if (unit.state === 'MAINTENANCE') throw conflict('UNIT_MAINTENANCE', `${unit.name} sedang maintenance`);
        if (unit.activeSession) throw conflict('UNIT_BUSY', `${unit.name} sedang dipakai`);

        let pkg: { id: string; name: string; durationMin: number; price: number } | null = null;
        if (input.mode === 'PACKAGE') {
          if (!input.packageId) throw badRequest('PACKAGE_REQUIRED', 'Pilih paket terlebih dahulu');
          const p = await tx.package.findUnique({ where: { id: input.packageId } });
          if (!p || !p.active) throw notFound('Paket');
          if (p.unitTypeId !== unit.unitTypeId) throw badRequest('PACKAGE_MISMATCH', 'Paket ini tidak berlaku untuk tipe meja tersebut');
          pkg = p;
        } else {
          findTariff(await loadTariffRules(tx), unit.unitTypeId, now, settings.utcOffsetMin); // gagal cepat bila tarif belum diatur
        }

        const bill = await tx.bill.create({
          data: { number: await nextBillNumber(tx, now, settings.utcOffsetMin), label: unit.name, createdById: user.id },
        });
        const s = await tx.session.create({
          data: {
            billId: bill.id,
            unitId: unit.id,
            activeUnitId: unit.id,
            mode: input.mode,
            packageId: pkg?.id ?? null,
            packageName: pkg?.name ?? null,
            packageDurationMin: pkg?.durationMin ?? null,
            packagePrice: pkg?.price ?? null,
            startedAt: now,
            plannedEndAt: pkg ? addMinutes(now, pkg.durationMin) : null,
            startedById: user.id,
            segments: { create: { unitId: unit.id, unitTypeId: unit.unitTypeId, startedAt: now } },
          },
        });
        if (unit.lightOverride !== null) await tx.unit.update({ where: { id: unit.id }, data: { lightOverride: null } });
        await audit(tx, { userId: user.id, action: 'session.start', entity: 'Session', entityId: s.id, data: { unitId: unit.id, mode: input.mode, packageId: pkg?.id ?? null } });
        return s;
      });
    } catch (err) {
      rethrowBusy(err, unitName);
    }
    this.touch(session.unitId);
    return session;
  }

  async stop(user: PublicUser, sessionId: string): Promise<{ session: Session; charge: TimeCharge }> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);

    const result = await prisma.$transaction(async (tx) => {
      await lockSession(tx, sessionId);
      const s = await tx.session.findUnique({ where: { id: sessionId }, include: sessionParts });
      if (!s) throw notFound('Sesi');
      if (s.status === 'ENDED') throw conflict('SESSION_ENDED', 'Sesi sudah selesai');
      const endAt = s.status === 'EXPIRED' && s.endedAt ? s.endedAt : now;

      await tx.sessionSegment.updateMany({ where: { sessionId: s.id, endedAt: null }, data: { endedAt: endAt } });
      await tx.sessionPause.updateMany({ where: { sessionId: s.id, resumedAt: null }, data: { resumedAt: endAt } });
      const closed = {
        ...s,
        endedAt: endAt,
        segments: s.segments.map((g) => ({ ...g, endedAt: g.endedAt ?? endAt })),
        pauses: s.pauses.map((p) => ({ ...p, resumedAt: p.resumedAt ?? endAt })),
      };
      const charge = stopCharge(closed, await loadTariffRules(tx), settings, endAt);

      const session = await tx.session.update({
        where: { id: s.id },
        data: {
          status: 'ENDED', endedAt: endAt, activeUnitId: null, endedById: user.id,
          chargeTotal: charge.total, chargeDetail: charge as unknown as Prisma.InputJsonValue,
        },
      });
      await tx.unit.updateMany({ where: { id: s.unitId, lightOverride: { not: null } }, data: { lightOverride: null } });
      await audit(tx, { userId: user.id, action: 'session.stop', entity: 'Session', entityId: s.id, data: { total: charge.total } });
      if (charge.fallback || charge.noTariff) {
        await audit(tx, {
          userId: user.id, action: 'session.tariff_fallback', entity: 'Session', entityId: s.id,
          data: {
            noTariff: charge.noTariff === true,
            fallbackLines: charge.lines.filter((l) => l.fallback).map((l) => ({ tariffId: l.tariffId, minutes: l.minutes, amount: l.amount })),
          },
        });
      }
      return { session, charge };
    });

    this.touch(result.session.unitId);
    return result;
  }

  private async loadForUpdate(tx: Db, sessionId: string) {
    await lockSession(tx, sessionId);
    const s = await tx.session.findUnique({ where: { id: sessionId } });
    if (!s) throw notFound('Sesi');
    if (s.status === 'ENDED') throw conflict('SESSION_ENDED', 'Sesi sudah selesai');
    return s;
  }

  async extend(user: PublicUser, sessionId: string, input: { minutes: number; requestId: string }): Promise<Session> {
    const { prisma } = this.ctx;
    const existing = async (db: Db) => {
      const dup = await db.sessionExtension.findUnique({ where: { requestId: input.requestId } });
      if (!dup) return null;
      if (dup.sessionId !== sessionId) throw conflict('REQUEST_ID_USED', 'ID permintaan sudah dipakai untuk sesi lain');
      return db.session.findUniqueOrThrow({ where: { id: dup.sessionId } });
    };
    let session: Session;
    try {
      session = await prisma.$transaction(async (tx) => {
        const dupFirst = await existing(tx);
        if (dupFirst) return dupFirst;
        const s = await this.loadForUpdate(tx, sessionId);
        const dup = await existing(tx); // ulangi setelah kunci: permintaan lain mungkin baru selesai
        if (dup) return dup;
        return this.applyExtend(tx, user, s, input);
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target ?? '').includes('requestId')) {
        session = (await existing(prisma))!;
      } else throw err;
    }
    this.touch(session.unitId);
    return session;
  }

  private async applyExtend(tx: Db, user: PublicUser, s: Session, input: { minutes: number; requestId: string }): Promise<Session> {
    const now = this.ctx.clock.now();
    if (s.mode === 'OPEN' || !s.plannedEndAt) throw badRequest('EXTEND_OPEN', 'Sesi open billing tidak perlu tambah waktu');
    await tx.sessionExtension.create({ data: { sessionId: s.id, minutes: input.minutes, requestId: input.requestId, createdById: user.id } });

    let updated: Session;
    if (s.status === 'EXPIRED') {
      const unit = await tx.unit.findUniqueOrThrow({ where: { id: s.unitId } });
      await tx.sessionSegment.create({ data: { sessionId: s.id, unitId: unit.id, unitTypeId: unit.unitTypeId, startedAt: now } });
      updated = await tx.session.update({
        where: { id: s.id },
        data: { status: 'RUNNING', endedAt: null, warnedAt: null, plannedEndAt: addMinutes(now, input.minutes) },
      });
    } else {
      updated = await tx.session.update({
        where: { id: s.id },
        data: { plannedEndAt: addMinutes(s.plannedEndAt, input.minutes), warnedAt: null },
      });
    }
    await audit(tx, { userId: user.id, action: 'session.extend', entity: 'Session', entityId: s.id, data: { minutes: input.minutes } });
    return updated;
  }

  async move(user: PublicUser, sessionId: string, toUnitId: string): Promise<{ from: string; to: string }> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const target = await prisma.unit.findUnique({ where: { id: toUnitId }, select: { name: true } });
    let result: { from: string; to: string };
    try {
      result = await prisma.$transaction(async (tx) => {
        const s = await this.loadForUpdate(tx, sessionId);
        if (s.status !== 'RUNNING' && s.status !== 'PAUSED') throw conflict('SESSION_NOT_ACTIVE', 'Sesi tidak sedang berjalan');
        if (s.unitId === toUnitId) throw badRequest('SAME_UNIT', 'Pilih meja lain');
        const to = await tx.unit.findUnique({ where: { id: toUnitId }, include: { activeSession: true } });
        if (!to) throw notFound('Meja tujuan');
        if (to.state === 'MAINTENANCE') throw conflict('UNIT_MAINTENANCE', `${to.name} sedang maintenance`);
        if (to.activeSession) throw conflict('UNIT_BUSY', `${to.name} sedang dipakai`);
        if (s.mode === 'OPEN') findTariff(await loadTariffRules(tx), to.unitTypeId, now, settings.utcOffsetMin); // sama seperti start

        await tx.sessionSegment.updateMany({ where: { sessionId: s.id, endedAt: null }, data: { endedAt: now } });
        await tx.sessionSegment.create({ data: { sessionId: s.id, unitId: to.id, unitTypeId: to.unitTypeId, startedAt: now } });
        await tx.session.update({ where: { id: s.id }, data: { unitId: to.id, activeUnitId: to.id } });
        await tx.unit.updateMany({ where: { id: { in: [s.unitId, to.id] }, lightOverride: { not: null } }, data: { lightOverride: null } });
        await audit(tx, { userId: user.id, action: 'session.move', entity: 'Session', entityId: s.id, data: { from: s.unitId, to: to.id } });
        return { from: s.unitId, to: to.id };
      });
    } catch (err) {
      rethrowBusy(err, target?.name ?? 'Meja tujuan');
    }
    this.touch(result.from, result.to);
    return result;
  }

  async pause(user: PublicUser, sessionId: string, approvalPin?: string): Promise<Session> {
    const { prisma, clock } = this.ctx;
    const approvedById = await approveWithPin(prisma, clock, user, approvalPin);
    const now = clock.now();
    const session = await prisma.$transaction(async (tx) => {
      const s = await this.loadForUpdate(tx, sessionId);
      if (s.status !== 'RUNNING') throw conflict('SESSION_NOT_RUNNING', 'Hanya sesi yang berjalan yang bisa di-pause');
      await tx.sessionPause.create({ data: { sessionId: s.id, pausedAt: now, approvedById } });
      const updated = await tx.session.update({ where: { id: s.id }, data: { status: 'PAUSED' } });
      await audit(tx, { userId: user.id, action: 'session.pause', entity: 'Session', entityId: s.id, approvedById });
      return updated;
    });
    this.touch(session.unitId);
    return session;
  }

  async resume(user: PublicUser, sessionId: string): Promise<Session> {
    const { prisma, clock } = this.ctx;
    const now = clock.now();
    const session = await prisma.$transaction(async (tx) => {
      const s = await this.loadForUpdate(tx, sessionId);
      if (s.status !== 'PAUSED') throw conflict('SESSION_NOT_PAUSED', 'Sesi tidak sedang di-pause');
      const open = await tx.sessionPause.findFirstOrThrow({ where: { sessionId: s.id, resumedAt: null } });
      await tx.sessionPause.update({ where: { id: open.id }, data: { resumedAt: now } });
      const pausedMs = now.getTime() - open.pausedAt.getTime();
      const updated = await tx.session.update({
        where: { id: s.id },
        data: {
          status: 'RUNNING',
          plannedEndAt: s.plannedEndAt ? new Date(s.plannedEndAt.getTime() + pausedMs) : null,
          warnedAt: null,
        },
      });
      await audit(tx, { userId: user.id, action: 'session.resume', entity: 'Session', entityId: s.id, data: { pausedMs } });
      return updated;
    });
    this.touch(session.unitId);
    return session;
  }
}
