import type { User } from '@prisma/client';
import { ROLES, type UserDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { badRequest } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireRole } from '../auth/guard';
import { hashSecret } from '../auth/password';

const fields = {
  name: z.string().trim().min(1).max(60),
  username: z.string().regex(/^[a-z0-9_.]{3,30}$/, 'Username 3–30 karakter: huruf kecil, angka, titik, garis bawah'),
  password: z.string().min(6, 'Password minimal 6 karakter'),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN 4–6 digit angka'),
  role: z.enum(ROLES),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, pin: fields.pin.optional(), active: fields.active.default(true) });
const updateSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

function toDto(u: User): UserDto {
  return { id: u.id, name: u.name, username: u.username, role: u.role, active: u.active, hasPin: u.pinHash !== null };
}

export function usersRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const owner = { preHandler: requireRole('OWNER') };

    app.get('/users', owner, async () => (await ctx.prisma.user.findMany({ orderBy: { name: 'asc' } })).map(toDto));

    app.post('/users', owner, async (req) => {
      const b = createSchema.parse(req.body);
      const u = await ctx.prisma.user.create({
        data: {
          name: b.name, username: b.username, role: b.role, active: b.active,
          passwordHash: await hashSecret(b.password),
          pinHash: b.pin ? await hashSecret(b.pin) : null,
        },
      });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'user.create', entity: 'User', entityId: u.id, data: { username: u.username, role: u.role } });
      return toDto(u);
    });

    app.patch('/users/:id', owner, async (req) => {
      const { id } = idParam.parse(req.params);
      const b = updateSchema.parse(req.body);
      if (id === req.user!.id && (b.active === false || (b.role !== undefined && b.role !== 'OWNER'))) {
        throw badRequest('SELF_LOCKOUT', 'Tidak bisa menonaktifkan atau menurunkan peran akun sendiri');
      }
      const u = await ctx.prisma.user.update({
        where: { id },
        data: {
          name: b.name, username: b.username, role: b.role, active: b.active,
          passwordHash: b.password ? await hashSecret(b.password) : undefined,
          pinHash: b.pin ? await hashSecret(b.pin) : undefined,
        },
      });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'user.update', entity: 'User', entityId: id, data: { fields: Object.keys(b) } });
      return toDto(u);
    });
  };
}
