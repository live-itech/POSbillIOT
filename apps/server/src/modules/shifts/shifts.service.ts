import { Prisma, type Shift } from '@prisma/client';
import { PAYMENT_METHODS, type PaymentMethod, type PublicUser, type ShiftSummary, type ShiftView } from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { conflict } from '../../lib/errors';
import { audit } from '../audit/audit';

export const currentShift = (db: Db) => db.shift.findFirst({ where: { openFlag: true } });

/**
 * `lock: true` (hanya di dalam transaksi) mengambil FOR SHARE pada baris shift terbuka, sehingga
 * ShiftService.close (FOR UPDATE) menunggu transaksi pembayaran/void yang sedang berjalan, dan
 * pembayaran tidak bisa masuk ke shift yang sudah ditutup.
 */
export async function requireOpenShift(db: Db, opts: { lock?: boolean } = {}): Promise<Shift> {
  if (opts.lock) {
    const rows = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Shift" WHERE "openFlag" = true FOR SHARE`;
    if (!rows.length) throw conflict('NO_OPEN_SHIFT', 'Belum ada shift terbuka. Buka shift terlebih dahulu.');
  }
  const s = await currentShift(db);
  if (!s) throw conflict('NO_OPEN_SHIFT', 'Belum ada shift terbuka. Buka shift terlebih dahulu.');
  return s;
}

export async function userNames(db: Db, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function toShiftView(db: Db, s: Shift): Promise<ShiftView> {
  const names = await userNames(db, [s.openedById, s.closedById]);
  return {
    id: s.id,
    openedAt: s.openedAt.toISOString(),
    openedByName: names.get(s.openedById) ?? '-',
    openingCash: s.openingCash,
    closedAt: s.closedAt?.toISOString() ?? null,
    closedByName: s.closedById ? (names.get(s.closedById) ?? '-') : null,
    countedCash: s.countedCash,
    expectedCash: s.expectedCash,
    note: s.note,
  };
}

const zero = () => Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;

export async function shiftSummary(db: Db, s: Shift): Promise<ShiftSummary> {
  const sales = zero();
  const voids = zero();
  for (const g of await db.payment.groupBy({ by: ['method'], where: { shiftId: s.id }, _sum: { amount: true } })) {
    sales[g.method] = g._sum.amount ?? 0;
  }
  for (const g of await db.payment.groupBy({ by: ['method'], where: { bill: { voidShiftId: s.id } }, _sum: { amount: true } })) {
    voids[g.method] = g._sum.amount ?? 0;
  }
  const [billCount, voidCount] = await Promise.all([
    db.bill.count({ where: { shiftId: s.id, status: { in: ['PAID', 'VOID'] } } }),
    db.bill.count({ where: { voidShiftId: s.id } }),
  ]);
  return { shift: await toShiftView(db, s), sales, voids, billCount, voidCount, expectedCash: s.openingCash + sales.CASH - voids.CASH };
}

export class ShiftService {
  constructor(private readonly ctx: AppContext) {}

  async open(user: PublicUser, openingCash: number): Promise<Shift> {
    const { prisma, clock } = this.ctx;
    let shift: Shift;
    try {
      shift = await prisma.shift.create({ data: { openedById: user.id, openedAt: clock.now(), openingCash, openFlag: true } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('SHIFT_ALREADY_OPEN', 'Masih ada shift terbuka. Tutup shift tersebut terlebih dahulu.');
      }
      throw err;
    }
    await audit(prisma, { userId: user.id, action: 'shift.open', entity: 'Shift', entityId: shift.id, data: { openingCash } });
    this.ctx.bus.emit('shift.changed');
    return shift;
  }

  async close(user: PublicUser, input: { countedCash: number; note?: string }): Promise<Shift> {
    const { prisma, clock } = this.ctx;
    const closed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Shift" WHERE "openFlag" = true FOR UPDATE`;
      const s = await requireOpenShift(tx);
      const summary = await shiftSummary(tx, s);
      const updated = await tx.shift.update({
        where: { id: s.id },
        data: {
          closedById: user.id,
          closedAt: clock.now(),
          countedCash: input.countedCash,
          expectedCash: summary.expectedCash,
          note: input.note?.trim() || null,
          openFlag: null,
        },
      });
      await audit(tx, {
        userId: user.id, action: 'shift.close', entity: 'Shift', entityId: s.id,
        data: { expectedCash: summary.expectedCash, countedCash: input.countedCash, difference: input.countedCash - summary.expectedCash },
      });
      return updated;
    });
    this.ctx.bus.emit('shift.changed');
    return closed;
  }
}
