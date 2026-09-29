import type { Device } from '@prisma/client';
import { DEVICE_DRIVERS, type DeviceDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { badRequest, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { requireAuth, requireRole } from '../auth/guard';
import { buildBoard, buildUnitView } from '../board/board';
import { SimulatorDriver } from './simulator.driver';

const fields = {
  name: z.string().trim().min(1).max(40),
  driver: z.enum(DEVICE_DRIVERS),
  channels: z.number().int().min(1).max(32),
  host: z.string().trim().min(1).nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  codec: z.string().trim().min(1).nullable(),
};
const createSchema = z.object({
  ...fields,
  channels: fields.channels.default(8),
  host: fields.host.default(null),
  port: fields.port.default(null),
  codec: fields.codec.default(null),
});
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });
const lightSchema = z.object({
  mode: z.enum(['ON', 'OFF', 'AUTO']),
  reason: z.string().trim().min(3, 'Alasan minimal 3 karakter').max(200),
  approvalPin: z.string().optional(),
});
const simulateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('set'), channel: z.number().int().min(1), on: z.boolean() }),
  z.object({ action: z.literal('online'), online: z.boolean() }),
]);

export function devicesRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };
    const toDto = (d: Device): DeviceDto => ({
      id: d.id, name: d.name, driver: d.driver, channels: d.channels, host: d.host, port: d.port, codec: d.codec,
      online: ctx.devices.online(d.id) ?? false, lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
    });

    app.get('/board', { preHandler: requireAuth }, async () => buildBoard(ctx));

    app.get('/devices', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.device.findMany({ orderBy: { name: 'asc' } })).map(toDto),
    );

    app.post('/devices', owner, async (req) => {
      const d = await ctx.prisma.device.create({ data: createSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'device.create', entity: 'Device', entityId: d.id });
      await ctx.devices.reload(d.id);
      return toDto(d);
    });

    app.patch('/devices/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = patchSchema.parse(req.body);
      if (b.channels !== undefined) {
        const maxUsed = await ctx.prisma.unit.aggregate({ where: { deviceId: id }, _max: { relayChannel: true } });
        if ((maxUsed._max.relayChannel ?? 0) > b.channels) {
          throw badRequest('CHANNEL_OUT_OF_RANGE', `Channel ${maxUsed._max.relayChannel} masih dipakai meja`);
        }
      }
      const d = await ctx.prisma.device.update({ where: { id }, data: b });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'device.update', entity: 'Device', entityId: id, data: b });
      await ctx.devices.reload(id);
      return toDto(d);
    });

    app.delete('/devices/:id', owner, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.device.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'device.delete', entity: 'Device', entityId: id });
      await ctx.devices.reload(id);
      return reply.status(204).send();
    });

    app.post('/units/:id/light', { preHandler: requireAuth }, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = lightSchema.parse(req.body);
      const approvedById = await approveWithPin(ctx.prisma, ctx.clock, req.user!, b.approvalPin);
      const unit = await ctx.prisma.unit.findUnique({ where: { id } });
      if (!unit) throw notFound('Meja');
      if (!unit.deviceId) throw badRequest('NO_DEVICE', `${unit.name} tidak terhubung ke device`);
      const lightOverride = b.mode === 'AUTO' ? null : b.mode === 'ON';
      await ctx.prisma.unit.update({ where: { id }, data: { lightOverride } });
      await audit(ctx.prisma, {
        userId: req.user!.id, action: 'device.override', entity: 'Unit', entityId: id,
        data: { mode: b.mode, reason: b.reason }, approvedById,
      });
      void ctx.devices.applyUnit(id);
      ctx.bus.emit('unit.changed', id);
      return { unit: await buildUnitView(ctx, id) };
    });

    app.post('/devices/:id/simulate', { preHandler: requireRole('SUPERVISOR', 'OWNER') }, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const b = simulateSchema.parse(req.body);
      const driver = ctx.devices.getDriver(id);
      if (!(driver instanceof SimulatorDriver)) throw badRequest('NOT_SIMULATOR', 'Device ini bukan simulator');
      if (b.action === 'set') driver.physicalSet(b.channel, b.on);
      else driver.setOnline(b.online);
      return reply.status(204).send();
    });
  };
}
