import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { notFound } from '../../lib/errors';
import { requireAuth } from '../auth/guard';
import { currentShift, shiftSummary, toShiftView } from './shifts.service';

const openSchema = z.object({ openingCash: z.number().int().min(0) });
const closeSchema = z.object({ countedCash: z.number().int().min(0), note: z.string().max(200).optional() });
const idParam = z.object({ id: z.string().min(1) });

export function shiftsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.get('/shifts/current', auth, async () => {
      const s = await currentShift(ctx.prisma);
      return { summary: s ? await shiftSummary(ctx.prisma, s) : null };
    });

    app.post('/shifts', auth, async (req) => {
      const s = await ctx.shifts.open(req.user!, openSchema.parse(req.body).openingCash);
      return { summary: await shiftSummary(ctx.prisma, s) };
    });

    app.post('/shifts/current/close', auth, async (req) => {
      const s = await ctx.shifts.close(req.user!, closeSchema.parse(req.body));
      return { summary: await shiftSummary(ctx.prisma, s) };
    });

    app.get('/shifts', auth, async () => {
      const rows = await ctx.prisma.shift.findMany({ orderBy: { openedAt: 'desc' }, take: 30 });
      return Promise.all(rows.map((s) => toShiftView(ctx.prisma, s)));
    });

    app.get('/shifts/:id', auth, async (req) => {
      const s = await ctx.prisma.shift.findUnique({ where: { id: idParam.parse(req.params).id } });
      if (!s) throw notFound('Shift');
      return shiftSummary(ctx.prisma, s);
    });
  };
}
