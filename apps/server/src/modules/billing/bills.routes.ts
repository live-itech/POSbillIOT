import { BILL_STATUSES } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';
import { discountSchema, loadBillView } from './bill-view';

const idParam = z.object({ id: z.string().min(1) });
const lineParam = z.object({ id: z.string().min(1), lineId: z.string().min(1) });
const qty = z.number().int().min(1).max(999);
const itemSchema = z.union([
  z.object({ productId: z.string().min(1), qty }),
  z.object({ custom: z.object({ name: z.string().trim().min(1).max(60), price: z.number().int().min(0) }), qty }),
]);
const addSchema = z.object({ items: z.array(itemSchema).min(1).max(50) });
const patchSchema = z.object({ qty: qty.optional(), discount: discountSchema.nullable().optional(), approvalPin: z.string().optional() });
const pinSchema = z.object({ approvalPin: z.string().optional() });
const listSchema = z.object({
  status: z.enum(BILL_STATUSES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().trim().max(40).optional(),
});
const cancelSchema = z.object({ reason: z.string().trim().min(1, 'Alasan wajib diisi').max(200), approvalPin: z.string().optional() });

export function billsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.get('/bills', auth, async (req) => {
      const f = listSchema.parse(req.query);
      return ctx.bills.list({ status: f.status, from: f.from ? new Date(f.from) : undefined, to: f.to ? new Date(f.to) : undefined, q: f.q || undefined });
    });
    app.get('/bills/:id', auth, async (req) => loadBillView(ctx.prisma, idParam.parse(req.params).id));
    app.post('/bills', auth, async (req) => ctx.bills.createStandalone(req.user!));
    app.post('/bills/:id/items', auth, async (req) => ctx.bills.addItems(req.user!, idParam.parse(req.params).id, addSchema.parse(req.body).items));
    app.patch('/bills/:id/items/:lineId', auth, async (req) => {
      const p = lineParam.parse(req.params);
      return ctx.bills.updateLine(req.user!, p.id, p.lineId, patchSchema.parse(req.body));
    });
    app.delete('/bills/:id/items/:lineId', auth, async (req) => {
      const p = lineParam.parse(req.params);
      return ctx.bills.deleteLine(req.user!, p.id, p.lineId, pinSchema.parse(req.body ?? {}).approvalPin);
    });
    app.put('/bills/:id/discount', auth, async (req) =>
      ctx.bills.setBillDiscount(req.user!, idParam.parse(req.params).id, z.object({ discount: discountSchema.nullable() }).parse(req.body).discount),
    );
    app.post('/bills/:id/cancel', auth, async (req) => ctx.bills.cancel(req.user!, idParam.parse(req.params).id, cancelSchema.parse(req.body)));
    app.post('/bills/:id/merge', auth, async (req) =>
      ctx.bills.merge(req.user!, idParam.parse(req.params).id, z.object({ sourceBillId: z.string().min(1) }).parse(req.body).sourceBillId),
    );
  };
}
