import { SESSION_MODES } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';
import { buildUnitView } from '../board/board';

const idParam = z.object({ id: z.string().min(1) });
const startSchema = z.object({
  unitId: z.string().min(1),
  mode: z.enum(SESSION_MODES),
  packageId: z.string().min(1).optional(),
  memberId: z.string().min(1).nullable().optional(),
});
const extendSchema = z.object({ minutes: z.number().int().min(1).max(600), requestId: z.string().min(8).max(64) });
const moveSchema = z.object({ toUnitId: z.string().min(1) });
const pauseSchema = z.object({ approvalPin: z.string().optional() });

export function sessionsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.post('/sessions', auth, async (req) => {
      const s = await ctx.sessions.start(req.user!, startSchema.parse(req.body));
      return { unit: await buildUnitView(ctx, s.unitId) };
    });

    app.post('/sessions/:id/stop', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const { session, charge } = await ctx.sessions.stop(req.user!, id);
      return { unit: await buildUnitView(ctx, session.unitId), charge };
    });

    app.post('/sessions/:id/extend', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const s = await ctx.sessions.extend(req.user!, id, extendSchema.parse(req.body));
      return { unit: await buildUnitView(ctx, s.unitId) };
    });

    app.post('/sessions/:id/move', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const { to } = await ctx.sessions.move(req.user!, id, moveSchema.parse(req.body).toUnitId);
      return { unit: await buildUnitView(ctx, to) };
    });

    app.post('/sessions/:id/pause', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const s = await ctx.sessions.pause(req.user!, id, pauseSchema.parse(req.body ?? {}).approvalPin);
      return { unit: await buildUnitView(ctx, s.unitId) };
    });

    app.post('/sessions/:id/resume', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const s = await ctx.sessions.resume(req.user!, id);
      return { unit: await buildUnitView(ctx, s.unitId) };
    });
  };
}
