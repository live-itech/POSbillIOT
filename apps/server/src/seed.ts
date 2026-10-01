import { PrismaClient } from '@prisma/client';
import { OUTLET_TYPES, type OutletType } from '@funplay/shared';
import { seedDemo } from './seed-data';

const prisma = new PrismaClient();
try {
  const raw = process.env.SEED_OUTLET_TYPE ?? 'BILLIARD';
  if (!(OUTLET_TYPES as readonly string[]).includes(raw)) throw new Error(`SEED_OUTLET_TYPE tidak valid: ${raw}`);
  const created = await seedDemo(prisma, raw as OutletType);
  console.log(created ? `Data demo ${raw} dibuat. Login: owner/owner123, supervisor/super123, kasir/kasir123` : 'Sudah ada data, seed dilewati.');
} catch (err) {
  console.error(`Seed gagal: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
