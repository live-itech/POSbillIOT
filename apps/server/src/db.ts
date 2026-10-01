import type { Prisma, PrismaClient } from '@prisma/client';

export type Db = PrismaClient | Prisma.TransactionClient;
