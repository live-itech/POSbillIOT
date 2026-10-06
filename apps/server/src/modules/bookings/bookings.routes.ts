import { BOOKING_STATUSES } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';
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
  };
}
