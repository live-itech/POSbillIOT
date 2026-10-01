import { PrismaClient } from '@prisma/client';
import { buildApp } from './app';
import { loadConfig } from './config';
import { systemClock } from './lib/clock';

const config = loadConfig();
const prisma = new PrismaClient();
const { app } = await buildApp({ prisma, clock: systemClock, config });
await app.listen({ port: config.PORT, host: config.HOST });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.once(sig, async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
