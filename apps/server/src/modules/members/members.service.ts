import type { Member, MemberLevel } from '@prisma/client';
import type { MemberDto, MemberLevelDto } from '@funplay/shared';
import { z } from 'zod';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';

export type MemberWithLevel = Member & { level: MemberLevel };

export const toLevelDto = (l: MemberLevel): MemberLevelDto => ({
  id: l.id, name: l.name, timeDiscountPct: l.timeDiscountPct, fnbDiscountPct: l.fnbDiscountPct, sortOrder: l.sortOrder, active: l.active,
});

export const toMemberDto = (m: MemberWithLevel): MemberDto => ({
  id: m.id, code: m.code, name: m.name, phone: m.phone, levelId: m.levelId, levelName: m.level.name, active: m.active, createdAt: m.createdAt.toISOString(),
});

const pct = z.number().int().min(0).max(100);
const levelFields = {
  name: z.string().trim().min(1).max(40),
  timeDiscountPct: pct,
  fnbDiscountPct: pct,
  sortOrder: z.number().int().min(0).max(9999),
  active: z.boolean(),
};
export const levelCreateSchema = z.object({
  ...levelFields,
  timeDiscountPct: pct.default(0),
  fnbDiscountPct: pct.default(0),
  sortOrder: levelFields.sortOrder.default(0),
  active: levelFields.active.default(true),
});
export const levelPatchSchema = z.object(levelFields).partial();

const phone = z.string().trim().max(20).regex(/^[0-9+\- ]*$/, 'No. HP hanya boleh berisi angka');
export const memberCreateSchema = z.object({ name: z.string().trim().min(1).max(60), phone: phone.default(''), levelId: z.string().min(1) });
export const memberPatchSchema = z
  .object({ name: z.string().trim().min(1).max(60), phone, levelId: z.string().min(1), active: z.boolean() })
  .partial();
export const memberQuerySchema = z.object({ q: z.string().trim().max(40).optional(), active: z.enum(['true', 'false']).optional() });

export const memberCode = (n: number): string => `M${String(n).padStart(4, '0')}`;

/**
 * Kunci baris MemberCounter (dibuat bila belum ada) dan kembalikan nomor berikutnya. Semua penulisan
 * member melewati kunci ini sehingga kode berurutan dan cek HP unik bebas race.
 */
export async function lockMemberCounter(tx: Db): Promise<number> {
  await tx.$executeRaw`INSERT INTO "MemberCounter" (id, "next") VALUES (1, 1) ON CONFLICT (id) DO NOTHING`;
  const rows = await tx.$queryRaw<{ next: number }[]>`SELECT "next" FROM "MemberCounter" WHERE id = 1 FOR UPDATE`;
  return rows[0]!.next;
}

export async function assertPhoneFree(tx: Db, phoneNo: string, exceptId: string | null): Promise<void> {
  if (!phoneNo) return;
  const other = await tx.member.findFirst({ where: { phone: phoneNo, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (other) throw conflict('PHONE_TAKEN', `No. HP sudah dipakai member aktif ${other.code}`);
}

export async function requireLevel(tx: Db, levelId: string): Promise<MemberLevel> {
  const l = await tx.memberLevel.findUnique({ where: { id: levelId } });
  if (!l) throw notFound('Level');
  if (!l.active) throw badRequest('LEVEL_INACTIVE', `Level ${l.name} tidak aktif`);
  return l;
}

/** Member aktif beserta level, untuk dipasang ke bill atau booking. */
export async function requireActiveMember(db: Db, memberId: string): Promise<MemberWithLevel> {
  const m = await db.member.findUnique({ where: { id: memberId }, include: { level: true } });
  if (!m) throw notFound('Member');
  if (!m.active) throw conflict('MEMBER_INACTIVE', `Member ${m.name} tidak aktif`);
  return m;
}

/** Kolom snapshot member di Bill: diskon level disalin saat dipasang (tidak ikut berubah bila level diedit). */
export function memberSnapshot(m: MemberWithLevel | null) {
  return {
    memberId: m?.id ?? null,
    memberName: m?.name ?? null,
    memberLevelName: m?.level.name ?? null,
    memberTimeDiscountPct: m?.level.timeDiscountPct ?? 0,
    memberFnbDiscountPct: m?.level.fnbDiscountPct ?? 0,
  };
}
