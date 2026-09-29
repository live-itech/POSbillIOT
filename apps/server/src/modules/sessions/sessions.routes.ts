import { SESSION_MODES } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';
import { buildUnitView } from '../board/board';

const idParam = z.object({ id: z.string().min(1) });
const startSchema = z.object({ unitId: z.string().min(1), mode: z.enum(SESSION_MODES), packageId: z.string().min(1).optional() });

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
  };
}
