import type { PublicUser, Role } from '@funplay/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../../context';
import { forbidden, unauthorized } from '../../lib/errors';
import { SESSION_COOKIE, userFromToken } from './auth.service';

declare module 'fastify' {
  interface FastifyRequest {
    user: PublicUser | null;
  }
}

export function installAuth(app: FastifyInstance, ctx: Pick<AppContext, 'prisma' | 'clock'>): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req) => {
    req.user = null;
    if (!req.url.startsWith('/api')) return;
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const un = req.unsignCookie(raw);
    if (!un.valid || !un.value) return;
    req.user = await userFromToken(ctx.prisma, ctx.clock, un.value);
  });
}

export async function requireAuth(req: FastifyRequest): Promise<void> {
  if (!req.user) throw unauthorized();
}

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest): Promise<void> => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
  };
}
