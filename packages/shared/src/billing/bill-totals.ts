import type { Discount, LineType, Scope } from '../transactions';

export type LineScope = 'BILLING' | 'FNB';
export const lineScope = (type: LineType): LineScope => (type === 'TIME' ? 'BILLING' : 'FNB');

export interface TotalsLineInput { id: string; scope: LineScope; amount: number; discount: Discount | null }
export interface TotalsSettings { taxPct: number; taxScope: Scope; servicePct: number; serviceScope: Scope }
export interface BillTotalsLine { id: string; amount: number; itemDiscount: number; billDiscount: number; net: number }
export interface BillTotals {
  lines: BillTotalsLine[];
  subtotal: number;
  itemDiscountTotal: number;
  billDiscountTotal: number;
  discountTotal: number;
  serviceTotal: number;
  taxTotal: number;
  grandTotal: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const inScope = (scope: Scope, s: LineScope) => scope === 'ALL' || scope === s;

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

/**
 * Total bill: subtotal → diskon item → diskon bill (dibagi proporsional ke baris) → service atas net
 * baris dalam `serviceScope` → pajak atas (net + service tak-dibulatkan) baris dalam `taxScope`.
 * Semua hasil integer Rupiah; dipakai pratinjau web dan angka final server.
 */
export function computeBillTotals(lines: TotalsLineInput[], billDiscount: Discount | null, s: TotalsSettings): BillTotals {
  const itemDisc = lines.map((l) => discountAmount(l.amount, l.discount));
  const afterItem = lines.map((l, i) => l.amount - itemDisc[i]!);
  const billDiscountTotal = discountAmount(sum(afterItem), billDiscount);
  const share = allocate(billDiscountTotal, afterItem);
  const out: BillTotalsLine[] = lines.map((l, i) => ({
    id: l.id,
    amount: l.amount,
    itemDiscount: itemDisc[i]!,
    billDiscount: share[i]!,
    net: afterItem[i]! - share[i]!,
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
  const discountTotal = itemDiscountTotal + billDiscountTotal;
  return {
    lines: out,
    subtotal,
    itemDiscountTotal,
    billDiscountTotal,
    discountTotal,
    serviceTotal,
    taxTotal,
    grandTotal: subtotal - discountTotal + serviceTotal + taxTotal,
  };
}

/** True bila total diskon melebihi `pct` persen subtotal (butuh PIN supervisor untuk kasir). */
export function needsDiscountApproval(t: BillTotals, pct: number): boolean {
  return t.discountTotal * 100 > t.subtotal * pct;
}
