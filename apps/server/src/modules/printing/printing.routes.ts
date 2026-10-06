import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const idParam = z.object({ id: z.string().min(1) });
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export function printingRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.post('/bills/:id/print', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const bill = await ctx.prisma.bill.findUnique({ where: { id }, select: { status: true } });
      if (!bill) throw notFound('Bill');
      if (bill.status !== 'PAID' && bill.status !== 'VOID') throw conflict('BILL_NOT_PAID', 'Struk hanya untuk bill yang sudah dibayar');
      await audit(ctx.prisma, { userId: req.user!.id, action: 'bill.reprint', entity: 'Bill', entityId: id });
      return ctx.printing.printReceipt(req.user!.id, id, true);
    });

    app.post('/shifts/:id/print', auth, async (req) => ctx.printing.printShiftReport(req.user!.id, idParam.parse(req.params).id));
    app.post('/print/test', { preHandler: requireRole('OWNER') }, async (req) => ctx.printing.printTest(req.user!.id));
    app.get('/print/jobs', auth, async (req) => ctx.printing.listJobs(listSchema.parse(req.query).limit));
  };
}
