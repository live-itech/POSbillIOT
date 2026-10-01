import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';
import { getSettings, settingsUpdateSchema } from './settings.service';

export function settingsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.get('/settings', { preHandler: requireAuth }, async () => getSettings(ctx.prisma));

    app.put('/settings', { preHandler: requireRole('OWNER') }, async (req) => {
      const data = settingsUpdateSchema.parse(req.body);
      await getSettings(ctx.prisma);
      await ctx.prisma.setting.update({ where: { id: 1 }, data });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'settings.update', entity: 'Setting', entityId: '1', data });
      ctx.bus.emit('board.changed');
      return getSettings(ctx.prisma);
    });
  };
}
