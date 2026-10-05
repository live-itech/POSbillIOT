import { PAYMENT_METHODS } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';

const idParam = z.object({ id: z.string().min(1) });
const checkoutSchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  expectedGrandTotal: z.number().int().min(0),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: z.number().int(),
        received: z.number().int().nullable().optional(),
        reference: z.string().trim().max(60).nullable().optional(),
      }),
    )
    .max(8),
  approvalPin: z.string().optional(),
});
const voidSchema = z.object({ reason: z.string().trim().min(1, 'Alasan wajib diisi').max(200), approvalPin: z.string().optional() });

export function checkoutRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };
    app.post('/bills/:id/checkout', auth, async (req) => ctx.checkout.checkout(req.user!, idParam.parse(req.params).id, checkoutSchema.parse(req.body)));
    app.post('/bills/:id/void', auth, async (req) => ctx.checkout.void(req.user!, idParam.parse(req.params).id, voidSchema.parse(req.body)));
  };
}
