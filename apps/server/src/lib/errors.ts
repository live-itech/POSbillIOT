import { Prisma } from '@prisma/client';
import { NoTariffError } from '@funplay/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} tidak ditemukan`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
export const badRequest = (code: string, message: string) => new AppError(400, code, message);
export const forbidden = (message = 'Anda tidak memiliki akses') => new AppError(403, 'FORBIDDEN', message);
export const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Silakan login terlebih dahulu');

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION', message: err.issues[0]?.message ?? 'Data tidak valid', issues: err.issues } });
    }
    if (err instanceof NoTariffError) {
      return reply.status(422).send({ error: { code: 'NO_TARIFF', message: 'Tarif untuk tipe ini belum diatur pada jam sekarang' } });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'Data sudah ada' } });
      if (err.code === 'P2003') return reply.status(409).send({ error: { code: 'IN_USE', message: 'Data masih dipakai oleh data lain' } });
      if (err.code === 'P2025') return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Data tidak ditemukan' } });
    }
    // relasi dengan onDelete: Restrict didorong ke Postgres (relationMode default "foreignKeys"),
    // sehingga pelanggarannya muncul sebagai error mentah (SQLSTATE 23001/23503), bukan P2003.
    if (err instanceof Prisma.PrismaClientUnknownRequestError && /code: "23(001|503)"/.test(err.message)) {
      return reply.status(409).send({ error: { code: 'IN_USE', message: 'Data masih dipakai oleh data lain' } });
    }
    const status = (err as FastifyError).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: { code: 'BAD_REQUEST', message: err.message } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' } });
  });
}
