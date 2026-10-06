import type { Product } from '@prisma/client';
import { PRODUCT_KINDS, type ProductDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const fields = {
  name: z.string().trim().min(1).max(60),
  categoryId: z.string().min(1),
  kind: z.enum(PRODUCT_KINDS),
  price: z.number().int().min(0),
  stockQty: z.number().int().min(-99999).max(99999),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, stockQty: fields.stockQty.default(0), active: fields.active.default(true) });
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

const toDto = (p: Product): ProductDto => ({ id: p.id, name: p.name, categoryId: p.categoryId, kind: p.kind, price: p.price, stockQty: p.stockQty, active: p.active });

export function productsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const editor = { preHandler: requireRole('SUPERVISOR', 'OWNER') };

    app.get('/products', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.product.findMany({ orderBy: { name: 'asc' } })).map(toDto),
    );

    app.post('/products', editor, async (req) => {
      const p = await ctx.prisma.product.create({ data: createSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'product.create', entity: 'Product', entityId: p.id });
      return toDto(p);
    });

    app.patch('/products/:id', editor, async (req) => {
      const { id } = idParam.parse(req.params);
      const data = patchSchema.parse(req.body);
      const p = await ctx.prisma.product.update({ where: { id }, data });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'product.update', entity: 'Product', entityId: id, data });
      return toDto(p);
    });

    app.delete('/products/:id', editor, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.product.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'product.delete', entity: 'Product', entityId: id });
      return reply.status(204).send();
    });
  };
}
