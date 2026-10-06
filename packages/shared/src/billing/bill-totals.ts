import type { Discount, LineType, Scope } from '../transactions';

/** PREPAID = baris DEPOSIT (DP booking): di luar semua cakupan dan tanpa diskon apa pun. */
export type LineScope = 'BILLING' | 'FNB' | 'PREPAID';
export const lineScope = (type: LineType): LineScope => (type === 'TIME' ? 'BILLING' : type === 'DEPOSIT' ? 'PREPAID' : 'FNB');

/** Persen diskon level member yang di-snapshot ke bill. */
export interface MemberDiscount { timePct: number; fnbPct: number }

export interface TotalsLineInput { id: string; scope: LineScope; amount: number; discount: Discount | null }
export interface TotalsSettings { taxPct: number; taxScope: Scope; servicePct: number; serviceScope: Scope }
export interface BillTotalsLine { id: string; amount: number; itemDiscount: number; memberDiscount: number; billDiscount: number; net: number }
export interface BillTotals {
  lines: BillTotalsLine[];
  subtotal: number;
  itemDiscountTotal: number;
  memberDiscountTotal: number;
  billDiscountTotal: number;
  discountTotal: number;
  serviceTotal: number;
  taxTotal: number;
  grandTotal: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const inScope = (scope: Scope, s: LineScope) => s !== 'PREPAID' && (scope === 'ALL' || scope === s);

/** Nilai diskon dalam Rupiah atas `base`: persen dibulatkan, hasil selalu 0..base. */
export function discountAmount(base: number, d: Discount | null): number {
  if (!d || base <= 0 || d.value <= 0) return 0;
  const raw = d.type === 'PERCENT' ? Math.round((base * Math.min(d.value, 100)) / 100) : Math.round(d.value);
  return Math.min(raw, base);
}

/** Bagi `total` ke `weights` secara proporsional (metode sisa terbesar). Jumlah hasil selalu = total. */
export function allocate(total: number, weights: number[]): number[] {
  const all = sum(weights);
  if (total <= 0 || all <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / all);
  const out = exact.map((e) => Math.floor(e));
  let rest = total - sum(out);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e), w: weights[i]! }))
    .sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);
  for (const o of order) {
    if (rest <= 0) break;
    out[o.i]! += 1;
    rest--;
  }
  return out;
}

/** Persen diskon member untuk satu baris: timePct untuk BILLING, fnbPct untuk FNB, 0 untuk PREPAID. */
export function memberDiscountPct(scope: LineScope, m: MemberDiscount | null): number {
  if (!m || scope === 'PREPAID') return 0;
  return scope === 'BILLING' ? m.timePct : m.fnbPct;
}

/**
 * Total bill: subtotal → diskon item → diskon member (baris tanpa diskon item) → diskon bill (dibagi
 * proporsional ke baris non-PREPAID) → service atas net baris dalam `serviceScope` → pajak atas
 * (net + service tak-dibulatkan) baris dalam `taxScope`. Baris PREPAID (DP) tidak pernah didiskon,
 * diservice, atau dipajaki. Semua hasil integer Rupiah; dipakai pratinjau web dan angka final server.
 */
export function computeBillTotals(
  lines: TotalsLineInput[],
  billDiscount: Discount | null,
  s: TotalsSettings,
  memberDiscount: MemberDiscount | null = null,
): BillTotals {
  const prepaid = lines.map((l) => l.scope === 'PREPAID');
  const itemDisc = lines.map((l, i) => (prepaid[i] ? 0 : discountAmount(l.amount, l.discount)));
  const memberDisc = lines.map((l, i) =>
    itemDisc[i]! > 0 ? 0 : discountAmount(l.amount, { type: 'PERCENT', value: memberDiscountPct(l.scope, memberDiscount) }),
  );
  const afterMember = lines.map((l, i) => l.amount - itemDisc[i]! - memberDisc[i]!);
  const weights = afterMember.map((a, i) => (prepaid[i] ? 0 : a));
  const billDiscountTotal = discountAmount(sum(weights), billDiscount);
  const share = allocate(billDiscountTotal, weights);
  const out: BillTotalsLine[] = lines.map((l, i) => ({
    id: l.id,
    amount: l.amount,
    itemDiscount: itemDisc[i]!,
    memberDiscount: memberDisc[i]!,
    billDiscount: share[i]!,
    net: afterMember[i]! - share[i]!,
  }));

  let serviceBase = 0;
  let taxBaseX100 = 0; // basis pajak × 100 agar service per baris tetap integer
  lines.forEach((l, i) => {
    const net = out[i]!.net;
    const svcX100 = inScope(s.serviceScope, l.scope) ? net * s.servicePct : 0;
    if (inScope(s.serviceScope, l.scope)) serviceBase += net;
    if (inScope(s.taxScope, l.scope)) taxBaseX100 += net * 100 + svcX100;
  });
  const serviceTotal = Math.round((serviceBase * s.servicePct) / 100);
  const taxTotal = Math.round((taxBaseX100 * s.taxPct) / 10000);

  const subtotal = sum(lines.map((l) => l.amount));
  const itemDiscountTotal = sum(itemDisc);
  const memberDiscountTotal = sum(memberDisc);
  const discountTotal = itemDiscountTotal + memberDiscountTotal + billDiscountTotal;
  return {
    lines: out,
    subtotal,
    itemDiscountTotal,
    memberDiscountTotal,
    billDiscountTotal,
    discountTotal,
    serviceTotal,
    taxTotal,
    grandTotal: subtotal - discountTotal + serviceTotal + taxTotal,
  };
}

/** True bila diskon (tanpa diskon member) melebihi `pct` persen subtotal (butuh PIN supervisor untuk kasir). */
export function needsDiscountApproval(t: BillTotals, pct: number): boolean {
  return (t.discountTotal - t.memberDiscountTotal) * 100 > t.subtotal * pct;
}
