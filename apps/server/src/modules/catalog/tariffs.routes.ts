import { daysToMask, formatHHMM, MINUTES_PER_DAY, parseHHMM } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { badRequest, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';
import { toTariffDto } from './tariffs.service';

const hhmm = z.string().regex(/^\d{2}:\d{2}$/, 'Format jam harus HH:MM');
const fields = {
  name: z.string().trim().min(1).max(40),
  unitTypeId: z.string().min(1),
  days: z.array(z.number().int().min(0).max(6)).min(1, 'Pilih minimal satu hari'),
  start: hhmm,
  end: hhmm,
  pricePerHour: z.number().int().min(0),
  priority: z.number().int(),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, priority: fields.priority.default(0), active: fields.active.default(true) });
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

function parseTimes(start: string, end: string): { startMin: number; endMin: number } {
  let s: number;
  let e: number;
  try {
    s = parseHHMM(start);
    e = parseHHMM(end);
  } catch {
    throw badRequest('INVALID_TIME', 'Format jam harus HH:MM');
  }
  if (s >= MINUTES_PER_DAY) throw badRequest('INVALID_TIME', 'Jam mulai maksimal 23:59');
  if (e === 0) e = MINUTES_PER_DAY;
  if (s === e) throw badRequest('INVALID_TIME', 'Jam mulai dan selesai tidak boleh sama (pakai 00:00–24:00 untuk sepanjang hari)');
  return { startMin: s, endMin: e };
}

export function tariffsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };

    app.get('/tariffs', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.tariff.findMany({ orderBy: [{ unitTypeId: 'asc' }, { startMin: 'asc' }] })).map(toTariffDto),
    );

    app.post('/tariffs', owner, async (req) => {
      const b = createSchema.parse(req.body);
      const t = await ctx.prisma.tariff.create({
        data: {
          name: b.name, unitTypeId: b.unitTypeId, daysMask: daysToMask(b.days), ...parseTimes(b.start, b.end),
          pricePerHour: b.pricePerHour, priority: b.priority, active: b.active,
        },
      });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'tariff.create', entity: 'Tariff', entityId: t.id });
      ctx.bus.emit('board.changed');
      return toTariffDto(t);
    });

    app.patch('/tariffs/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = patchSchema.parse(req.body);
      const cur = await ctx.prisma.tariff.findUnique({ where: { id } });
      if (!cur) throw notFound('Tarif');
      const times = b.start !== undefined || b.end !== undefined ? parseTimes(b.start ?? formatHHMM(cur.startMin), b.end ?? formatHHMM(cur.endMin)) : {};
      const t = await ctx.prisma.tariff.update({
        where: { id },
        data: {
          name: b.name, unitTypeId: b.unitTypeId, pricePerHour: b.pricePerHour, priority: b.priority, active: b.active,
          daysMask: b.days ? daysToMask(b.days) : undefined,
          ...times,
        },
      });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'tariff.update', entity: 'Tariff', entityId: id, data: b });
      ctx.bus.emit('board.changed');
      return toTariffDto(t);
    });

    app.delete('/tariffs/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.tariff.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'tariff.delete', entity: 'Tariff', entityId: id });
      ctx.bus.emit('board.changed');
      return reply.status(204).send();
    });
  };
}
