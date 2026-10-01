import type { AppContext } from '../../context';
import { emitAlert } from '../../lib/alerts';
import { audit } from '../audit/audit';
import { getSettings } from '../settings/settings.service';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly ctx: AppContext) {}

  start(intervalMs = 1000): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (err) {
      console.error('[scheduler] tick gagal', err);
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<void> {
    const { prisma, clock, bus } = this.ctx;
    const now = clock.now();
    const settings = await getSettings(prisma);
    const sessions = await prisma.session.findMany({
      where: { status: 'RUNNING', plannedEndAt: { not: null } },
      include: { unit: { select: { id: true, name: true } } },
    });

    for (const s of sessions) {
      try {
        await this.process(s, now, settings.warnBeforeMin);
      } catch (err) {
        console.error(`[scheduler] sesi ${s.id} gagal diproses`, err);
      }
    }
  }

  private async process(
    s: { id: string; plannedEndAt: Date | null; warnedAt: Date | null; unit: { id: string; name: string } },
    now: Date,
    warnBeforeMin: number,
  ): Promise<void> {
    const { prisma, clock, bus } = this.ctx;
    const end = s.plannedEndAt!;
    if (now.getTime() >= end.getTime()) {
      await this.expire(s.id, s.unit.id, s.unit.name, end);
      return;
    }
    const leftMs = end.getTime() - now.getTime();
    if (!s.warnedAt && leftMs <= warnBeforeMin * 60_000) {
      const w = await prisma.session.updateMany({ where: { id: s.id, plannedEndAt: end, warnedAt: null }, data: { warnedAt: now } });
      if (w.count > 0) {
        emitAlert(bus, clock, {
          level: 'warning',
          type: 'SESSION_WARNING',
          unitId: s.unit.id,
          message: `${s.unit.name}: sisa waktu ${Math.ceil(leftMs / 60_000)} menit`,
        });
        bus.emit('unit.changed', s.unit.id);
      }
    }
  }

  private async expire(sessionId: string, unitId: string, unitName: string, endAt: Date): Promise<void> {
    const { prisma, clock, bus, devices } = this.ctx;
    const changed = await prisma.$transaction(async (tx) => {
      const r = await tx.session.updateMany({ where: { id: sessionId, status: 'RUNNING', plannedEndAt: endAt }, data: { status: 'EXPIRED', endedAt: endAt } });
      if (r.count === 0) return false;
      await tx.sessionSegment.updateMany({ where: { sessionId, endedAt: null }, data: { endedAt: endAt } });
      await tx.unit.updateMany({ where: { id: unitId, lightOverride: { not: null } }, data: { lightOverride: null } });
      await audit(tx, { userId: null, action: 'session.expire', entity: 'Session', entityId: sessionId });
      return true;
    });
    if (!changed) return;
    emitAlert(bus, clock, { level: 'danger', type: 'SESSION_EXPIRED', unitId, message: `${unitName}: waktu habis` });
    void devices.applyUnit(unitId);
    bus.emit('unit.changed', unitId);
  }
}
