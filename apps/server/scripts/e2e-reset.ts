// Mengosongkan semua tabel (kecuali _prisma_migrations) pada DB E2E.
// Menolak berjalan bila DATABASE_URL bukan DB E2E.
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
const dbName = new URL(url).pathname.replace(/^\//, '');
if (!dbName.endsWith('_e2e')) {
  console.error(`Menolak mengosongkan database "${dbName}": bukan database E2E (*_e2e).`);
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
} finally {
  await prisma.$disconnect();
}
