import type { PrismaClient } from '@prisma/client';
import type { OutletType } from '@funplay/shared';
import { hashSecret } from './modules/auth/password';

interface TypeSeed {
  name: string;
  color: string;
  tariffs: { name: string; startMin: number; endMin: number; pricePerHour: number }[];
  packages: { name: string; durationMin: number; price: number }[];
  units: string[];
}

const BILLIARD: TypeSeed[] = [
  {
    name: 'Reguler', color: '#7C3AED',
    tariffs: [
      { name: 'Reguler Siang', startMin: 480, endMin: 1080, pricePerHour: 40000 },
      { name: 'Reguler Malam', startMin: 1080, endMin: 480, pricePerHour: 50000 },
    ],
    packages: [
      { name: 'Paket 2 Jam Reguler', durationMin: 120, price: 75000 },
      { name: 'Paket 3 Jam Reguler', durationMin: 180, price: 105000 },
    ],
    units: ['Meja 1', 'Meja 2', 'Meja 3', 'Meja 4', 'Meja 5', 'Meja 6'],
  },
  {
    name: 'VIP', color: '#F59E0B',
    tariffs: [
      { name: 'VIP Siang', startMin: 480, endMin: 1080, pricePerHour: 60000 },
      { name: 'VIP Malam', startMin: 1080, endMin: 480, pricePerHour: 75000 },
    ],
    packages: [{ name: 'Paket 2 Jam VIP', durationMin: 120, price: 110000 }],
    units: ['VIP 1', 'VIP 2'],
  },
];

const PLAYSTATION: TypeSeed[] = [
  {
    name: 'PS4', color: '#06B6D4',
    tariffs: [{ name: 'PS4', startMin: 0, endMin: 1440, pricePerHour: 10000 }],
    packages: [{ name: 'Paket 3 Jam PS4', durationMin: 180, price: 25000 }],
    units: ['PS4 #1', 'PS4 #2', 'PS4 #3', 'PS4 #4'],
  },
  {
    name: 'PS5', color: '#7C3AED',
    tariffs: [{ name: 'PS5', startMin: 0, endMin: 1440, pricePerHour: 15000 }],
    packages: [{ name: 'Paket 3 Jam PS5', durationMin: 180, price: 40000 }],
    units: ['PS5 #1', 'PS5 #2', 'PS5 #3', 'PS5 #4'],
  },
];

interface CategorySeed { name: string; color: string; products: { name: string; price: number; kind: 'STOCK' | 'SERVICE'; stockQty: number }[] }

const FNB: CategorySeed[] = [
  {
    name: 'Minuman', color: '#06B6D4',
    products: [
      { name: 'Es Teh Manis', price: 8000, kind: 'STOCK', stockQty: 50 },
      { name: 'Kopi Susu', price: 15000, kind: 'STOCK', stockQty: 30 },
      { name: 'Air Mineral', price: 6000, kind: 'STOCK', stockQty: 48 },
    ],
  },
  {
    name: 'Makanan', color: '#F59E0B',
    products: [
      { name: 'Mie Goreng', price: 15000, kind: 'STOCK', stockQty: 20 },
      { name: 'Kentang Goreng', price: 18000, kind: 'STOCK', stockQty: 20 },
    ],
  },
];

const SERVICES: Record<OutletType, CategorySeed> = {
  BILLIARD: { name: 'Layanan', color: '#7C3AED', products: [{ name: 'Sewa Stick Premium', price: 10000, kind: 'SERVICE', stockQty: 0 }] },
  PLAYSTATION: { name: 'Layanan', color: '#7C3AED', products: [{ name: 'Stik Tambahan', price: 5000, kind: 'SERVICE', stockQty: 0 }] },
};

export async function seedDemo(prisma: PrismaClient, outletType: OutletType): Promise<boolean> {
  if ((await prisma.user.count()) > 0) return false;

  const users = await Promise.all(
    [
      { name: 'Owner', username: 'owner', password: 'owner123', pin: '1234', role: 'OWNER' as const },
      { name: 'Supervisor', username: 'supervisor', password: 'super123', pin: '1111', role: 'SUPERVISOR' as const },
      { name: 'Kasir', username: 'kasir', password: 'kasir123', pin: null, role: 'KASIR' as const },
    ].map(async (u) => ({
      name: u.name,
      username: u.username,
      role: u.role,
      passwordHash: await hashSecret(u.password),
      pinHash: u.pin ? await hashSecret(u.pin) : null,
    })),
  );

  return prisma.$transaction(async (tx) => {
    if ((await tx.user.count()) > 0) return false;
    await tx.setting.upsert({ where: { id: 1 }, create: { id: 1, outletType }, update: { outletType } });
    for (const data of users) await tx.user.create({ data });

    const device = await tx.device.create({ data: { name: 'Simulator Relay A', driver: 'simulator', channels: 8 } });
    let channel = 1;
    for (const t of outletType === 'PLAYSTATION' ? PLAYSTATION : BILLIARD) {
      const type = await tx.unitType.create({ data: { name: t.name, color: t.color } });
      await tx.tariff.createMany({ data: t.tariffs.map((x) => ({ ...x, unitTypeId: type.id })) });
      await tx.package.createMany({ data: t.packages.map((x) => ({ ...x, unitTypeId: type.id })) });
      for (const name of t.units) {
        await tx.unit.create({ data: { name, unitTypeId: type.id, deviceId: device.id, relayChannel: channel, sortOrder: channel } });
        channel++;
      }
    }
    for (const [i, c] of [...FNB, SERVICES[outletType]].entries()) {
      const cat = await tx.category.create({ data: { name: c.name, color: c.color, sortOrder: i } });
      await tx.product.createMany({ data: c.products.map((p) => ({ ...p, categoryId: cat.id })) });
    }
    return true;
  });
}
