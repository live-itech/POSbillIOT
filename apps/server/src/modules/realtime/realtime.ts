import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import type { AppContext } from '../../context';
import { SESSION_COOKIE, userFromToken } from '../auth/auth.service';
import { buildBoard, buildUnitView } from '../board/board';

export function attachRealtime(app: FastifyInstance, ctx: AppContext): Server {
  const io = new Server(app.server, { path: '/socket.io', serveClient: false });

  io.use(async (socket, next) => {
    try {
      const cookies = app.parseCookie(socket.request.headers.cookie ?? '');
      const raw = cookies[SESSION_COOKIE];
      const un = raw ? app.unsignCookie(raw) : null;
      const user = un?.valid && un.value ? await userFromToken(ctx.prisma, ctx.clock, un.value) : null;
      if (!user) return next(new Error('UNAUTHORIZED'));
      socket.data.user = user;
      next();
    } catch (err) {
      next(err as Error);
    }
  });

  io.on('connection', async (socket) => {
    try {
      await socket.join('board');
      socket.emit('board', await buildBoard(ctx));
    } catch (err) {
      app.log.warn({ err }, 'realtime: gagal mengirim board saat connect');
      socket.disconnect(true);
    }
  });

  const room = () => io.to('board');
  const log = (err: unknown) => app.log.warn({ err }, 'realtime gagal');

  ctx.bus.on('unit.changed', (unitId) => {
    void buildUnitView(ctx, unitId)
      .then(async (view) => (view ? room().emit('unit', view) : room().emit('board', await buildBoard(ctx))))
      .catch(log);
  });
  ctx.bus.on('board.changed', () => {
    void buildBoard(ctx).then((b) => room().emit('board', b)).catch(log);
  });
  ctx.bus.on('alert', (a) => room().emit('alert', a));
  ctx.bus.on('device.changed', (d) => room().emit('device', d));
  ctx.bus.on('bill.changed', (id) => room().emit('bill', { id }));
  ctx.bus.on('shift.changed', () => room().emit('shift'));
  ctx.bus.on('booking.changed', (id) => room().emit('booking', { id }));
  ctx.bus.on('print.job', (job) => room().emit('printJob', job));

  app.addHook('onClose', async () => {
    await io.close();
  });
  return io;
}
