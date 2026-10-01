import type { Prisma } from '@prisma/client';
import type { Db } from '../../db';

export interface AuditEntry {
  userId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  data?: Prisma.InputJsonValue;
  approvedById?: string | null;
}

export function audit(db: Db, e: AuditEntry) {
  return db.auditLog.create({
    data: {
      userId: e.userId,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      data: e.data ?? {},
      approvedById: e.approvedById ?? null,
    },
  });
}
