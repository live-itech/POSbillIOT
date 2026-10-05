import type { Category } from '@prisma/client';
import type { CategoryDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const fields = {
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Warna harus format #RRGGBB'),
  sortOrder: z.number().int().min(0).max(9999),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, color: fields.color.default('#7C3AED'), sortOrder: fields.sortOrder.default(0), active: fields.active.default(true) });
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

const toDto = (c: Category): CategoryDto => ({ id: c.id, name: c.name, color: c.color, sortOrder: c.sortOrder, active: c.active });

export function categoriesRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const editor = { preHandler: requireRole('SUPERVISOR', 'OWNER') };

    app.get('/categories', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(toDto),
    );

    app.post('/categories', editor, async (req) => {
      const c = await ctx.prisma.category.create({ data: createSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'category.create', entity: 'Category', entityId: c.id });
      return toDto(c);
    });

    app.patch('/categories/:id', editor, async (req) => {
      const { id } = idParam.parse(req.params);
      const c = await ctx.prisma.category.update({ where: { id }, data: patchSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'category.update', entity: 'Category', entityId: id });
      return toDto(c);
    });

    app.delete('/categories/:id', editor, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.category.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'category.delete', entity: 'Category', entityId: id });
      return reply.status(204).send();
    });
  };
}
