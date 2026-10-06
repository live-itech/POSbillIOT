import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';
import {
  assertPhoneFree, levelCreateSchema, levelPatchSchema, lockMemberCounter, memberCode, memberCreateSchema, memberPatchSchema,
  memberQuerySchema, requireLevel, toLevelDto, toMemberDto,
} from './members.service';

const idParam = z.object({ id: z.string().min(1) });

export function membersRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };
    const editor = { preHandler: requireRole('SUPERVISOR', 'OWNER') };

    app.get('/member-levels', auth, async () =>
      (await ctx.prisma.memberLevel.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(toLevelDto),
    );

    app.post('/member-levels', editor, async (req) => {
      const l = await ctx.prisma.memberLevel.create({ data: levelCreateSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'member_level.create', entity: 'MemberLevel', entityId: l.id });
      return toLevelDto(l);
    });

    app.patch('/member-levels/:id', editor, async (req) => {
      const { id } = idParam.parse(req.params);
      const data = levelPatchSchema.parse(req.body);
      const l = await ctx.prisma.memberLevel.update({ where: { id }, data });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'member_level.update', entity: 'MemberLevel', entityId: id, data });
      return toLevelDto(l);
    });

    app.delete('/member-levels/:id', editor, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.memberLevel.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'member_level.delete', entity: 'MemberLevel', entityId: id });
      return reply.status(204).send();
    });

    app.get('/members', auth, async (req) => {
      const f = memberQuerySchema.parse(req.query);
      const rows = await ctx.prisma.member.findMany({
        where: {
          ...(f.active ? { active: f.active === 'true' } : {}),
          ...(f.q
            ? { OR: [{ code: { contains: f.q, mode: 'insensitive' } }, { name: { contains: f.q, mode: 'insensitive' } }, { phone: { contains: f.q } }] }
            : {}),
        },
        include: { level: true },
        orderBy: { name: 'asc' },
        take: 50,
      });
      return rows.map(toMemberDto);
    });

    app.get('/members/:id', auth, async (req) => {
      const m = await ctx.prisma.member.findUnique({ where: { id: idParam.parse(req.params).id }, include: { level: true } });
      if (!m) throw notFound('Member');
      return toMemberDto(m);
    });

    app.post('/members', editor, async (req) => {
      const input = memberCreateSchema.parse(req.body);
      const m = await ctx.prisma.$transaction(async (tx) => {
        const n = await lockMemberCounter(tx);
        await requireLevel(tx, input.levelId);
        await assertPhoneFree(tx, input.phone, null);
        await tx.memberCounter.update({ where: { id: 1 }, data: { next: n + 1 } });
        const created = await tx.member.create({ data: { ...input, code: memberCode(n) }, include: { level: true } });
        await audit(tx, { userId: req.user!.id, action: 'member.create', entity: 'Member', entityId: created.id, data: { code: created.code } });
        return created;
      });
      return toMemberDto(m);
    });

    app.patch('/members/:id', editor, async (req) => {
      const { id } = idParam.parse(req.params);
      const data = memberPatchSchema.parse(req.body);
      const m = await ctx.prisma.$transaction(async (tx) => {
        await lockMemberCounter(tx);
        const cur = await tx.member.findUnique({ where: { id } });
        if (!cur) throw notFound('Member');
        if (data.levelId && data.levelId !== cur.levelId) await requireLevel(tx, data.levelId);
        if (data.active ?? cur.active) await assertPhoneFree(tx, data.phone ?? cur.phone, id);
        const updated = await tx.member.update({ where: { id }, data, include: { level: true } });
        await audit(tx, { userId: req.user!.id, action: 'member.update', entity: 'Member', entityId: id, data });
        return updated;
      });
      return toMemberDto(m);
    });

    app.delete('/members/:id', editor, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const used = (await ctx.prisma.bill.count({ where: { memberId: id } })) + (await ctx.prisma.booking.count({ where: { memberId: id } }));
      if (used > 0) throw conflict('MEMBER_IN_USE', 'Member sudah pernah bertransaksi. Nonaktifkan saja.');
      await ctx.prisma.member.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'member.delete', entity: 'Member', entityId: id });
      return reply.status(204).send();
    });
  };
}
