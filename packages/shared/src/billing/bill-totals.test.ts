import { describe, expect, it } from 'vitest';
import { allocate, computeBillTotals, discountAmount, lineScope, needsDiscountApproval, type TotalsLineInput, type TotalsSettings } from './bill-totals';

const NO_TAX: TotalsSettings = { taxPct: 0, taxScope: 'ALL', servicePct: 0, serviceScope: 'ALL' };
const time = (amount: number, id = 't'): TotalsLineInput => ({ id, scope: 'BILLING', amount, discount: null });
const fnb = (amount: number, id = 'f'): TotalsLineInput => ({ id, scope: 'FNB', amount, discount: null });

describe('lineScope', () => {
  it('TIME = BILLING, DEPOSIT = PREPAID, lainnya FNB', () => {
    expect(lineScope('TIME')).toBe('BILLING');
    expect(lineScope('PRODUCT')).toBe('FNB');
    expect(lineScope('SERVICE')).toBe('FNB');
    expect(lineScope('CUSTOM')).toBe('FNB');
    expect(lineScope('DEPOSIT')).toBe('PREPAID');
  });
});

describe('discountAmount', () => {
  it('persen dibulatkan, nominal dibatasi base', () => {
    expect(discountAmount(20000, { type: 'PERCENT', value: 10 })).toBe(2000);
    expect(discountAmount(12345, { type: 'PERCENT', value: 10 })).toBe(1235);
    expect(discountAmount(5000, { type: 'AMOUNT', value: 999999 })).toBe(5000);
    expect(discountAmount(5000, { type: 'PERCENT', value: 150 })).toBe(5000);
    expect(discountAmount(5000, null)).toBe(0);
    expect(discountAmount(0, { type: 'AMOUNT', value: 100 })).toBe(0);
  });
});

describe('allocate', () => {
  it('jumlah hasil = total, sisa ke pecahan terbesar lalu indeks terkecil', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(4000, [30000, 10000])).toEqual([3000, 1000]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
    expect(allocate(0, [10, 20])).toEqual([0, 0]);
  });
});

describe('computeBillTotals', () => {
  it('tanpa diskon/pajak: total = subtotal', () => {
    const t = computeBillTotals([time(50000), fnb(20000)], null, NO_TAX);
    expect(t).toMatchObject({ subtotal: 70000, discountTotal: 0, memberDiscountTotal: 0, serviceTotal: 0, taxTotal: 0, grandTotal: 70000 });
  });

  it('diskon item lalu diskon bill dibagi proporsional', () => {
    const t = computeBillTotals(
      [time(30000, 'a'), { ...fnb(12000, 'b'), discount: { type: 'AMOUNT', value: 2000 } }],
      { type: 'PERCENT', value: 10 },
      NO_TAX,
    );
    // setelah diskon item: 30000 + 10000 = 40000 → diskon bill 4000 → 3000 / 1000
    expect(t.itemDiscountTotal).toBe(2000);
    expect(t.billDiscountTotal).toBe(4000);
    expect(t.lines).toEqual([
      { id: 'a', amount: 30000, itemDiscount: 0, memberDiscount: 0, billDiscount: 3000, net: 27000 },
      { id: 'b', amount: 12000, itemDiscount: 2000, memberDiscount: 0, billDiscount: 1000, net: 9000 },
    ]);
    expect(t).toMatchObject({ subtotal: 42000, discountTotal: 6000, grandTotal: 36000 });
  });

  it('service FNB 10% lalu pajak ALL 11% atas net + service', () => {
    const t = computeBillTotals([time(50000), fnb(20000)], null, { taxPct: 11, taxScope: 'ALL', servicePct: 10, serviceScope: 'FNB' });
    expect(t.serviceTotal).toBe(2000);
    expect(t.taxTotal).toBe(7920); // 11% × (50000 + 20000 + 2000)
    expect(t.grandTotal).toBe(79920);
  });

  it('pajak hanya BILLING, service ALL 5%', () => {
    const t = computeBillTotals([time(50000), fnb(20000)], null, { taxPct: 10, taxScope: 'BILLING', servicePct: 5, serviceScope: 'ALL' });
    expect(t.serviceTotal).toBe(3500);
    expect(t.taxTotal).toBe(5250); // 10% × (50000 + 2500)
    expect(t.grandTotal).toBe(78750);
  });

  it('cakupan NONE menonaktifkan pajak/service', () => {
    const t = computeBillTotals([time(50000)], null, { taxPct: 11, taxScope: 'NONE', servicePct: 10, serviceScope: 'NONE' });
    expect(t).toMatchObject({ serviceTotal: 0, taxTotal: 0, grandTotal: 50000 });
  });

  it('bill kosong → semua nol', () => {
    expect(computeBillTotals([], { type: 'AMOUNT', value: 5000 }, NO_TAX)).toMatchObject({ subtotal: 0, discountTotal: 0, grandTotal: 0, lines: [] });
  });

  it('diskon member: TIME pakai timePct, FNB pakai fnbPct, dibulatkan', () => {
    const t = computeBillTotals([time(50000, 'a'), fnb(20000, 'b'), fnb(12345, 'c')], null, NO_TAX, { timePct: 10, fnbPct: 5 });
    // 5000 + 1000 + round(617,25) = 617
    expect(t.lines.map((l) => l.memberDiscount)).toEqual([5000, 1000, 617]);
    expect(t.lines.map((l) => l.net)).toEqual([45000, 19000, 11728]);
    expect(t).toMatchObject({ subtotal: 82345, memberDiscountTotal: 6617, discountTotal: 6617, grandTotal: 75728 });
  });

  it('baris dengan diskon item tidak mendapat diskon member', () => {
    const t = computeBillTotals([{ ...fnb(20000, 'a'), discount: { type: 'AMOUNT', value: 2000 } }, fnb(10000, 'b')], null, NO_TAX, { timePct: 0, fnbPct: 10 });
    expect(t.lines).toEqual([
      { id: 'a', amount: 20000, itemDiscount: 2000, memberDiscount: 0, billDiscount: 0, net: 18000 },
      { id: 'b', amount: 10000, itemDiscount: 0, memberDiscount: 1000, billDiscount: 0, net: 9000 },
    ]);
    expect(t).toMatchObject({ itemDiscountTotal: 2000, memberDiscountTotal: 1000, discountTotal: 3000, grandTotal: 27000 });
  });

  it('diskon member sebelum diskon bill; baris PREPAID di luar diskon, service, dan pajak', () => {
    const t = computeBillTotals(
      [{ id: 'dp', scope: 'PREPAID', amount: 50000, discount: { type: 'PERCENT', value: 50 } }, fnb(20000, 'f')],
      { type: 'PERCENT', value: 10 },
      { taxPct: 10, taxScope: 'ALL', servicePct: 10, serviceScope: 'ALL' },
      { timePct: 10, fnbPct: 10 },
    );
    // f: member 2000 → 18000; bill 10% = 1800 → net 16200; service 1620; pajak 10% × (16200 + 1620) = 1782
    expect(t.lines[0]).toEqual({ id: 'dp', amount: 50000, itemDiscount: 0, memberDiscount: 0, billDiscount: 0, net: 50000 });
    expect(t.lines[1]).toEqual({ id: 'f', amount: 20000, itemDiscount: 0, memberDiscount: 2000, billDiscount: 1800, net: 16200 });
    expect(t).toMatchObject({ subtotal: 70000, discountTotal: 3800, serviceTotal: 1620, taxTotal: 1782, grandTotal: 69602 });
  });

  it('invarian untuk 300 input acak (termasuk member & PREPAID)', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const lineScopes = ['BILLING', 'FNB', 'PREPAID'] as const;
    for (let k = 0; k < 300; k++) {
      const lines: TotalsLineInput[] = Array.from({ length: 1 + rnd(5) }, (_, i) => ({
        id: String(i),
        scope: lineScopes[rnd(3)]!,
        amount: rnd(200000),
        discount: rnd(3) === 0 ? { type: rnd(2) ? 'PERCENT' : 'AMOUNT', value: rnd(2) ? rnd(101) : rnd(50000) } : null,
      }));
      const scopes = ['NONE', 'BILLING', 'FNB', 'ALL'] as const;
      const member = rnd(2) ? { timePct: rnd(101), fnbPct: rnd(101) } : null;
      const t = computeBillTotals(
        lines,
        rnd(2) ? { type: 'PERCENT', value: rnd(101) } : { type: 'AMOUNT', value: rnd(100000) },
        { taxPct: rnd(21), taxScope: scopes[rnd(4)]!, servicePct: rnd(21), serviceScope: scopes[rnd(4)]! },
        member,
      );
      expect(t.grandTotal).toBe(t.subtotal - t.discountTotal + t.serviceTotal + t.taxTotal);
      expect(t.discountTotal).toBe(t.itemDiscountTotal + t.memberDiscountTotal + t.billDiscountTotal);
      expect(t.lines.reduce((a, l) => a + l.net, 0)).toBe(t.subtotal - t.discountTotal);
      for (const v of [t.subtotal, t.discountTotal, t.serviceTotal, t.taxTotal, t.grandTotal]) {
        expect(Number.isInteger(v) && v >= 0).toBe(true);
      }
      t.lines.forEach((l, i) => {
        expect(l.net).toBeGreaterThanOrEqual(0);
        if (lines[i]!.scope === 'PREPAID') expect(l.net).toBe(l.amount);
      });
    }
  });
});

describe('needsDiscountApproval', () => {
  it('hanya bila diskon > batas persen subtotal', () => {
    const base = computeBillTotals([fnb(70000)], { type: 'AMOUNT', value: 7000 }, NO_TAX);
    expect(needsDiscountApproval(base, 10)).toBe(false);
    const more = computeBillTotals([fnb(70000)], { type: 'AMOUNT', value: 7001 }, NO_TAX);
    expect(needsDiscountApproval(more, 10)).toBe(true);
    expect(needsDiscountApproval(computeBillTotals([], null, NO_TAX), 10)).toBe(false);
  });

  it('mengabaikan diskon member', () => {
    const member = computeBillTotals([fnb(70000)], null, NO_TAX, { timePct: 0, fnbPct: 50 });
    expect(member.memberDiscountTotal).toBe(35000);
    expect(needsDiscountApproval(member, 10)).toBe(false);
    // diskon bill 7001 di atas diskon member 50% → 7001 > 10% × 70000
    const extra = computeBillTotals([fnb(70000)], { type: 'AMOUNT', value: 7001 }, NO_TAX, { timePct: 0, fnbPct: 50 });
    expect(needsDiscountApproval(extra, 10)).toBe(true);
  });
});
