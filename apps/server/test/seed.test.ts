import { beforeEach, expect, it } from 'vitest';
import { verifySecret } from '../src/modules/auth/password';
import { seedDemo } from '../src/seed-data';
import { prisma, resetDb } from './helpers';

beforeEach(() => resetDb());

it('seed billiard membuat 8 meja, 3 user, dan idempoten', async () => {
  expect(await seedDemo(prisma, 'BILLIARD')).toBe(true);
  expect(await prisma.unit.count()).toBe(8);
  expect(await prisma.user.count()).toBe(3);
  expect(await prisma.tariff.count()).toBe(4);
  expect((await prisma.setting.findUniqueOrThrow({ where: { id: 1 } })).outletType).toBe('BILLIARD');
  expect(await seedDemo(prisma, 'BILLIARD')).toBe(false);
  expect(await prisma.unit.count()).toBe(8);
});

it('seed playstation memakai tipe PS4/PS5', async () => {
  await seedDemo(prisma, 'PLAYSTATION');
  const types = (await prisma.unitType.findMany({ orderBy: { name: 'asc' } })).map((t) => t.name);
  expect(types).toEqual(['PS4', 'PS5']);
  expect((await prisma.unit.findFirstOrThrow({ orderBy: { sortOrder: 'asc' } })).name).toBe('PS4 #1');
  expect(await prisma.product.findUnique({ where: { name: 'Stik Tambahan' } })).toMatchObject({ kind: 'SERVICE', price: 5000 });
});

it('seed menyediakan data yang dipakai E2E', async () => {
  await seedDemo(prisma, 'BILLIARD');
  expect(await prisma.package.findFirst({ where: { name: 'Paket 2 Jam Reguler' } })).not.toBeNull();
  const units = await prisma.unit.findMany({ orderBy: { sortOrder: 'asc' } });
  expect(units.map((u) => u.relayChannel)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  const kasir = await prisma.user.findUniqueOrThrow({ where: { username: 'kasir' } });
  expect(await verifySecret(kasir.passwordHash, 'kasir123')).toBe(true);
  const spv = await prisma.user.findUniqueOrThrow({ where: { username: 'supervisor' } });
  expect(await verifySecret(spv.pinHash!, '1111')).toBe(true);
  const teh = await prisma.product.findUniqueOrThrow({ where: { name: 'Es Teh Manis' }, include: { category: true } });
  expect(teh).toMatchObject({ price: 8000, kind: 'STOCK', category: { name: 'Minuman' } });
  expect((await prisma.product.findUniqueOrThrow({ where: { name: 'Kopi Susu' } })).price).toBe(15000);
  expect(await prisma.product.findUnique({ where: { name: 'Sewa Stick Premium' } })).toMatchObject({ kind: 'SERVICE' });
  expect(await prisma.memberLevel.findUnique({ where: { name: 'Reguler' } })).toMatchObject({ timeDiscountPct: 0, fnbDiscountPct: 0, active: true });
});

it('seed gagal di tengah jalan di-rollback penuh', async () => {
  await prisma.unitType.create({ data: { name: 'Reguler', color: '#000000' } });
  await expect(seedDemo(prisma, 'BILLIARD')).rejects.toThrow();
  expect(await prisma.user.count()).toBe(0);
  expect(await prisma.device.count()).toBe(0);
  expect(await prisma.unit.count()).toBe(0);
});
