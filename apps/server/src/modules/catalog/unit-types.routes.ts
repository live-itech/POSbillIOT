import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const schema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Warna harus format #RRGGBB').default('#7C3AED'),
});
const idParam = z.object({ id: z.string().min(1) });

export function unitTypesRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };
    const toDto = (t: { id: string; name: string; color: string }) => ({ id: t.id, name: t.name, color: t.color });

    app.get('/unit-types', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.unitType.findMany({ orderBy: { name: 'asc' } })).map(toDto),
    );

    app.post('/unit-types', owner, async (req) => {
      const t = await ctx.prisma.unitType.create({ data: schema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unitType.create', entity: 'UnitType', entityId: t.id });
      ctx.bus.emit('board.changed');
      return toDto(t);
    });

    app.patch('/unit-types/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const t = await ctx.prisma.unitType.update({ where: { id }, data: schema.partial().parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unitType.update', entity: 'UnitType', entityId: id });
      ctx.bus.emit('board.changed');
      return toDto(t);
    });

    app.delete('/unit-types/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.unitType.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unitType.delete', entity: 'UnitType', entityId: id });
      ctx.bus.emit('board.changed');
      return reply.status(204).send();
    });
  };
}
