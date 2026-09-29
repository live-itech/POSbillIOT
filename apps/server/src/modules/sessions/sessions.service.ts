import { Prisma, type Session } from '@prisma/client';
import {
  addMinutes, computeSessionCharge, findTariff, localDateKey,
  type PublicUser, type SessionMode, type TimeCharge,
} from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { loadTariffRules } from '../catalog/tariffs.service';
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

        const bill = await tx.bill.create({ data: { number: await nextBillNumber(tx, now, settings.utcOffsetMin), createdById: user.id } });
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
      const charge = computeSessionCharge(closed, await loadTariffRules(tx), settings, endAt);

      const session = await tx.session.update({
        where: { id: s.id },
        data: {
          status: 'ENDED', endedAt: endAt, activeUnitId: null, endedById: user.id,
          chargeTotal: charge.total, chargeDetail: charge as unknown as Prisma.InputJsonValue,
        },
      });
      await audit(tx, { userId: user.id, action: 'session.stop', entity: 'Session', entityId: s.id, data: { total: charge.total } });
      return { session, charge };
    });

    this.touch(result.session.unitId);
    return result;
  }
}
