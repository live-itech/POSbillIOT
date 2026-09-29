import type { Setting } from '@prisma/client';
import { OUTLET_TYPES, type PublicSettings } from '@funplay/shared';
import { z } from 'zod';
import type { Db } from '../../db';

export function toPublicSettings(s: Setting): PublicSettings {
  return {
    outletType: s.outletType,
    outletName: s.outletName,
    address: s.address,
    utcOffsetMin: s.utcOffsetMin,
    roundingBlockMin: s.roundingBlockMin,
    minChargeMin: s.minChargeMin,
    warnBeforeMin: s.warnBeforeMin,
    pauseKeepsLightOn: s.pauseKeepsLightOn,
    autoOffUnexpected: s.autoOffUnexpected,
  };
}

/** Jangan dipanggil di dalam transaksi: create yang bentrok akan membatalkan transaksi Postgres. */
export async function getSettings(db: Db): Promise<PublicSettings> {
  const found = await db.setting.findUnique({ where: { id: 1 } });
  if (found) return toPublicSettings(found);
  try {
    return toPublicSettings(await db.setting.create({ data: { id: 1 } }));
  } catch {
    return toPublicSettings(await db.setting.findUniqueOrThrow({ where: { id: 1 } }));
  }
}

export const settingsUpdateSchema = z
  .object({
    outletType: z.enum(OUTLET_TYPES),
    outletName: z.string().trim().min(1).max(80),
    address: z.string().trim().max(200),
    utcOffsetMin: z.number().int().min(-720).max(840),
    roundingBlockMin: z.number().int().min(1, 'Blok pembulatan minimal 1 menit').max(60),
    minChargeMin: z.number().int().min(0).max(600),
    warnBeforeMin: z.number().int().min(0).max(60),
    pauseKeepsLightOn: z.boolean(),
    autoOffUnexpected: z.boolean(),
  })
  .partial();
