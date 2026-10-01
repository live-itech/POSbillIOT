import type { Unit } from '@prisma/client';
import { UNIT_STATES, type UnitDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const fields = {
  name: z.string().trim().min(1).max(40),
  unitTypeId: z.string().min(1),
  area: z.string().trim().max(40),
  deviceId: z.string().min(1).nullable(),
  relayChannel: z.number().int().nullable(),
  state: z.enum(UNIT_STATES),
  sortOrder: z.number().int(),
};
const createSchema = z.object({
  ...fields,
  area: fields.area.default(''),
  deviceId: fields.deviceId.default(null),
  relayChannel: fields.relayChannel.default(null),
  state: fields.state.default('ACTIVE'),
  sortOrder: fields.sortOrder.default(0),
});
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

export function toUnitDto(u: Unit): UnitDto {
  return {
    id: u.id, name: u.name, unitTypeId: u.unitTypeId, area: u.area, deviceId: u.deviceId,
    relayChannel: u.relayChannel, state: u.state, sortOrder: u.sortOrder, lightOverride: u.lightOverride,
  };
}

async function validateMapping(db: Db, deviceId: string | null, relayChannel: number | null): Promise<void> {
  if ((deviceId === null) !== (relayChannel === null)) {
    throw badRequest('MAPPING_INCOMPLETE', 'Device dan channel relay harus diisi bersamaan');
  }
  if (deviceId === null || relayChannel === null) return;
  const device = await db.device.findUnique({ where: { id: deviceId } });
  if (!device) throw notFound('Device');
  if (relayChannel < 1 || relayChannel > device.channels) {
    throw badRequest('CHANNEL_OUT_OF_RANGE', `Channel relay harus 1–${device.channels}`);
  }
}

export function unitsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };

    app.get('/units', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.unit.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(toUnitDto),
    );

    app.post('/units', owner, async (req) => {
      const b = createSchema.parse(req.body);
      await validateMapping(ctx.prisma, b.deviceId, b.relayChannel);
      const u = await ctx.prisma.unit.create({ data: b });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unit.create', entity: 'Unit', entityId: u.id });
      ctx.bus.emit('board.changed');
      return toUnitDto(u);
    });

    app.patch('/units/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = patchSchema.parse(req.body);
      const current = await ctx.prisma.unit.findUnique({ where: { id }, include: { activeSession: true } });
      if (!current) throw notFound('Meja');
      if (b.state === 'MAINTENANCE' && current.activeSession) {
        throw conflict('UNIT_BUSY', `${current.name} sedang dipakai, hentikan sesi dulu`);
      }
      await validateMapping(
        ctx.prisma,
        b.deviceId !== undefined ? b.deviceId : current.deviceId,
        b.relayChannel !== undefined ? b.relayChannel : current.relayChannel,
      );
      const u = await ctx.prisma.unit.update({ where: { id }, data: b });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unit.update', entity: 'Unit', entityId: id, data: b });
      ctx.bus.emit('board.changed');
      return toUnitDto(u);
    });

    app.delete('/units/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.unit.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'unit.delete', entity: 'Unit', entityId: id });
      ctx.bus.emit('board.changed');
      return reply.status(204).send();
    });
  };
}
