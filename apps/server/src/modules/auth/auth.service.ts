import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import type { PublicUser } from '@funplay/shared';
import { AppError } from '../../lib/errors';
import type { Clock } from '../../lib/clock';
import { audit } from '../audit/audit';
import { verifySecret } from './password';

export const SESSION_COOKIE = 'fp_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PIN_MAX_FAILS = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, name: u.name, username: u.username, role: u.role };
}

export async function login(prisma: PrismaClient, clock: Clock, username: string, password: string) {
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.active || !(await verifySecret(user.passwordHash, password))) {
    throw new AppError(401, 'INVALID_LOGIN', 'Username atau password salah');
  }
  const token = randomBytes(32).toString('base64url');
  await prisma.loginSession.create({
    data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(clock.now().getTime() + SESSION_TTL_MS) },
  });
  await audit(prisma, { userId: user.id, action: 'auth.login', entity: 'User', entityId: user.id });
  return { token, user: toPublicUser(user) };
}

export async function userFromToken(prisma: PrismaClient, clock: Clock, token: string): Promise<PublicUser | null> {
  const s = await prisma.loginSession.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!s || s.expiresAt <= clock.now() || !s.user.active) return null;
  return toPublicUser(s.user);
}

export async function logout(prisma: PrismaClient, token: string): Promise<void> {
  await prisma.loginSession.deleteMany({ where: { tokenHash: sha256(token) } });
}

const pinLocked = () => new AppError(423, 'PIN_LOCKED', 'Terlalu banyak PIN salah. Coba lagi beberapa menit lagi.');

/**
 * Mencadangkan satu percobaan PIN secara atomik sebelum verifikasi (argon2 lambat), sehingga
 * percobaan paralel tidak bisa melewati batas. Null bila user sedang terkunci atau jatah percobaan
 * sudah habis dipakai percobaan lain yang masih berjalan. Waktu memakai `clock` (bukan now() DB).
 */
async function reservePinAttempt(prisma: PrismaClient, userId: string, now: Date): Promise<number | null> {
  const nowUtc = now.toISOString();
  const rows = await prisma.$queryRaw<{ failedPinCount: number }[]>`
    UPDATE "User" SET "failedPinCount" = "failedPinCount" + 1
    WHERE id = ${userId}
      AND ("lockedUntil" IS NULL OR "lockedUntil" <= (${nowUtc}::timestamptz AT TIME ZONE 'UTC'))
      AND "failedPinCount" < ${PIN_MAX_FAILS}
    RETURNING "failedPinCount"`;
  return rows[0]?.failedPinCount ?? null;
}

/** Mengembalikan id user yang menyetujui aksi sensitif. */
export async function approveWithPin(prisma: PrismaClient, clock: Clock, requester: PublicUser, pin?: string): Promise<string> {
  if (requester.role !== 'KASIR') return requester.id;
  if (!pin) throw new AppError(403, 'APPROVAL_REQUIRED', 'Aksi ini butuh PIN supervisor');

  const attempt = await reservePinAttempt(prisma, requester.id, clock.now());
  if (attempt === null) throw pinLocked();

  let approverId: string | null = null;
  try {
    const approvers = await prisma.user.findMany({
      where: { active: true, role: { in: ['SUPERVISOR', 'OWNER'] }, pinHash: { not: null } },
    });
    for (const a of approvers) {
      if (a.pinHash && (await verifySecret(a.pinHash, pin))) {
        approverId = a.id;
        break;
      }
    }
  } catch (err) {
    // Verifikasi gagal karena error teknis: kembalikan jatah percobaan yang dicadangkan.
    await prisma.user.updateMany({ where: { id: requester.id, failedPinCount: { gt: 0 } }, data: { failedPinCount: { decrement: 1 } } });
    throw err;
  }

  if (approverId) {
    await prisma.user.update({ where: { id: requester.id }, data: { failedPinCount: 0, lockedUntil: null } });
    return approverId;
  }
  if (attempt >= PIN_MAX_FAILS) {
    await prisma.user.update({
      where: { id: requester.id },
      data: { failedPinCount: 0, lockedUntil: new Date(clock.now().getTime() + PIN_LOCK_MS) },
    });
  }
  throw new AppError(403, 'PIN_INVALID', 'PIN supervisor salah');
}
