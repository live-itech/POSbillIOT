import type { Tariff } from '@prisma/client';
import { formatHHMM, maskToDays, type TariffDto, type TariffRule } from '@funplay/shared';
import type { Db } from '../../db';

export function toTariffRule(t: Tariff): TariffRule {
  return {
    id: t.id, unitTypeId: t.unitTypeId, name: t.name, daysMask: t.daysMask,
    startMin: t.startMin, endMin: t.endMin, pricePerHour: t.pricePerHour, priority: t.priority,
  };
}

export function toTariffDto(t: Tariff): TariffDto {
  return {
    id: t.id, name: t.name, unitTypeId: t.unitTypeId, days: maskToDays(t.daysMask),
    start: formatHHMM(t.startMin), end: formatHHMM(t.endMin),
    pricePerHour: t.pricePerHour, priority: t.priority, active: t.active,
  };
}

export async function loadTariffRules(db: Db): Promise<TariffRule[]> {
  return (await db.tariff.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } })).map(toTariffRule);
}
