import type { Package } from '@prisma/client';
import type { PackageDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const fields = {
  name: z.string().trim().min(1).max(40),
  unitTypeId: z.string().min(1),
  durationMin: z.number().int().min(1).max(1440),
  price: z.number().int().min(0),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, active: fields.active.default(true) });
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

const toDto = (p: Package): PackageDto => ({ id: p.id, name: p.name, unitTypeId: p.unitTypeId, durationMin: p.durationMin, price: p.price, active: p.active });

export function packagesRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };

    app.get('/packages', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.package.findMany({ orderBy: [{ unitTypeId: 'asc' }, { durationMin: 'asc' }] })).map(toDto),
    );

    app.post('/packages', owner, async (req) => {
      const p = await ctx.prisma.package.create({ data: createSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'package.create', entity: 'Package', entityId: p.id });
      ctx.bus.emit('board.changed');
      return toDto(p);
    });

    app.patch('/packages/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const p = await ctx.prisma.package.update({ where: { id }, data: patchSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'package.update', entity: 'Package', entityId: id });
      ctx.bus.emit('board.changed');
      return toDto(p);
    });

    app.delete('/packages/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.package.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'package.delete', entity: 'Package', entityId: id });
      ctx.bus.emit('board.changed');
      return reply.status(204).send();
    });
  };
}
