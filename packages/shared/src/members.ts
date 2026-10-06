export interface MemberLevelDto { id: string; name: string; timeDiscountPct: number; fnbDiscountPct: number; sortOrder: number; active: boolean }

export interface MemberDto {
  id: string;
  code: string;
  name: string;
  phone: string;
  levelId: string;
  levelName: string;
  active: boolean;
  createdAt: string;
}

/** Member di bill: nama, level, dan persen diskon adalah snapshot saat member dipasang. */
export interface BillMemberView { id: string; code: string; name: string; levelName: string; timeDiscountPct: number; fnbDiscountPct: number }

export const memberLabel = (m: { name: string; levelName: string }): string => `${m.name} (${m.levelName})`;
