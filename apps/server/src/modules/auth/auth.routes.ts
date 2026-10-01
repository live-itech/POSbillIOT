import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { login, logout, SESSION_COOKIE, SESSION_TTL_MS } from './auth.service';
import { requireAuth } from './guard';

const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });

export function authRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    app.post('/auth/login', async (req, reply) => {
      const body = loginSchema.parse(req.body);
      const { token, user } = await login(ctx.prisma, ctx.clock, body.username, body.password);
      reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', signed: true, maxAge: SESSION_TTL_MS / 1000 });
      return { user };
    });

    app.post('/auth/logout', async (req, reply) => {
      const raw = req.cookies[SESSION_COOKIE];
      if (raw) {
        const un = req.unsignCookie(raw);
        if (un.valid && un.value) await logout(ctx.prisma, un.value);
      }
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.status(204).send();
    });

    app.get('/auth/me', { preHandler: requireAuth }, async (req) => ({ user: req.user }));
  };
}
