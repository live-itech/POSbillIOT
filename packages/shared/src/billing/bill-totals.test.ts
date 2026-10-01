import { describe, expect, it } from 'vitest';
import { allocate, computeBillTotals, discountAmount, lineScope, needsDiscountApproval, type TotalsLineInput, type TotalsSettings } from './bill-totals';

const NO_TAX: TotalsSettings = { taxPct: 0, taxScope: 'ALL', servicePct: 0, serviceScope: 'ALL' };
const time = (amount: number, id = 't'): TotalsLineInput => ({ id, scope: 'BILLING', amount, discount: null });
const fnb = (amount: number, id = 'f'): TotalsLineInput => ({ id, scope: 'FNB', amount, discount: null });

describe('lineScope', () => {
  it('TIME = BILLING, lainnya FNB', () => {
    expect(lineScope('TIME')).toBe('BILLING');
    expect(lineScope('PRODUCT')).toBe('FNB');
    expect(lineScope('SERVICE')).toBe('FNB');
    expect(lineScope('CUSTOM')).toBe('FNB');
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
    expect(t).toMatchObject({ subtotal: 70000, discountTotal: 0, serviceTotal: 0, taxTotal: 0, grandTotal: 70000 });
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
      { id: 'a', amount: 30000, itemDiscount: 0, billDiscount: 3000, net: 27000 },
      { id: 'b', amount: 12000, itemDiscount: 2000, billDiscount: 1000, net: 9000 },
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

  it('invarian untuk 300 input acak', () => {
    let seed = 42;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let k = 0; k < 300; k++) {
      const lines: TotalsLineInput[] = Array.from({ length: 1 + rnd(5) }, (_, i) => ({
        id: String(i),
        scope: rnd(2) ? 'BILLING' : 'FNB',
        amount: rnd(200000),
        discount: rnd(3) === 0 ? { type: rnd(2) ? 'PERCENT' : 'AMOUNT', value: rnd(2) ? rnd(101) : rnd(50000) } : null,
      }));
      const scopes = ['NONE', 'BILLING', 'FNB', 'ALL'] as const;
      const t = computeBillTotals(lines, rnd(2) ? { type: 'PERCENT', value: rnd(101) } : { type: 'AMOUNT', value: rnd(100000) }, {
        taxPct: rnd(21), taxScope: scopes[rnd(4)]!, servicePct: rnd(21), serviceScope: scopes[rnd(4)]!,
      });
      expect(t.grandTotal).toBe(t.subtotal - t.discountTotal + t.serviceTotal + t.taxTotal);
      expect(t.lines.reduce((a, l) => a + l.net, 0)).toBe(t.subtotal - t.discountTotal);
      for (const v of [t.subtotal, t.discountTotal, t.serviceTotal, t.taxTotal, t.grandTotal]) {
        expect(Number.isInteger(v) && v >= 0).toBe(true);
      }
      for (const l of t.lines) expect(l.net).toBeGreaterThanOrEqual(0);
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
});
