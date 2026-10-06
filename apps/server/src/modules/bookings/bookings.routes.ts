import { BOOKING_STATUSES, SESSION_MODES, type CheckInResult } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';
import { buildUnitView } from '../board/board';
import { MAX_BOOKING_MIN } from './bookings.service';

const idParam = z.object({ id: z.string().min(1) });
const fields = {
  unitId: z.string().min(1),
  startAt: z.string().datetime().transform((s) => new Date(s)),
  durationMin: z.number().int().min(15).max(MAX_BOOKING_MIN),
  customerName: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(20).optional(),
  memberId: z.string().min(1).nullable().optional(),
  note: z.string().trim().max(200).optional(),
};
const createSchema = z.object({ ...fields, depositAmount: z.number().int().min(0).max(100_000_000).default(0) });
const patchSchema = z.object(fields).partial();
const checkInSchema = z.object({ mode: z.enum(SESSION_MODES), packageId: z.string().min(1).optional() });
const reason = z.string().trim().min(1, 'Alasan wajib diisi').max(200);
const cancelSchema = z.object({ reason, deposit: z.enum(['FORFEIT', 'REFUND']).default('FORFEIT'), approvalPin: z.string().optional() });
const refundSchema = z.object({ reason, approvalPin: z.string().optional() });
const listSchema = z.object({ from: z.string().datetime(), to: z.string().datetime(), status: z.enum(BOOKING_STATUSES).optional() });

export function bookingsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.get('/bookings', auth, async (req) => {
      const f = listSchema.parse(req.query);
      return ctx.bookings.list({ from: new Date(f.from), to: new Date(f.to), status: f.status });
    });
    app.get('/bookings/:id', auth, async (req) => ctx.bookings.get(idParam.parse(req.params).id));
    app.post('/bookings', auth, async (req) => ctx.bookings.create(req.user!, createSchema.parse(req.body)));
    app.patch('/bookings/:id', auth, async (req) => ctx.bookings.update(req.user!, idParam.parse(req.params).id, patchSchema.parse(req.body)));
    app.post('/bookings/:id/check-in', auth, async (req): Promise<CheckInResult> => {
      const { id } = idParam.parse(req.params);
      const r = await ctx.bookings.checkIn(req.user!, id, checkInSchema.parse(req.body));
      return { unit: await buildUnitView(ctx, r.unitId), booking: await ctx.bookings.get(id) };
    });
    app.post('/bookings/:id/cancel', auth, async (req) => ctx.bookings.cancel(req.user!, idParam.parse(req.params).id, cancelSchema.parse(req.body)));
    app.post('/bookings/:id/refund-deposit', auth, async (req) =>
      ctx.bookings.refundDeposit(req.user!, idParam.parse(req.params).id, refundSchema.parse(req.body)),
    );
  };
}
