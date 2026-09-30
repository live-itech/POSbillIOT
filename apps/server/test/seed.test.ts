import { beforeEach, expect, it } from 'vitest';
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
});
