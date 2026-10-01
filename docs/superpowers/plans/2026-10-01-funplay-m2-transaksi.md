# FunPlay M2 — Transaksi: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyelesaikan siklus transaksi FunPlay — katalog FnB/layanan, bill & pesanan, stop tanpa bayar, checkout dengan diskon/service/pajak dan split payment, gabung/batal/void bill, shift kasir, serta struk ESC/POS dengan printer simulator — di atas fondasi M1.

**Architecture:** Kalkulator total bill, validasi pembayaran, dan renderer struk adalah fungsi murni di `packages/shared` (dipakai pratinjau web dan angka final server). Server menambah modul `shifts`, `catalog` (produk), `billing` (bill, pesanan, checkout, void, gabung), dan `printing` (antrean `PrintJob` + driver Simulator/USB/LAN); semua mutasi uang berjalan dalam satu transaksi Postgres dengan kunci baris dan idempotency key. Web menambah status shift di header, panel pesanan + dialog Pesan/Checkout di layar Meja, halaman Transaksi, Shift, Produk, tab pengaturan baru, dan panel simulator printer; pembaruan lintas perangkat lewat event Socket.IO yang meng-invalidate query.

**Tech Stack:** sama dengan M1 — Node.js 22, pnpm 10, TypeScript 5, Fastify 5, Prisma 6, PostgreSQL, Socket.IO 4, zod 3, Vitest 3, React 19, Vite 7, Tailwind CSS 4, TanStack Query 5, zustand 5, Radix Dialog, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-01-funplay-m2-transaksi-design.md` (spec induk: `docs/superpowers/specs/2026-09-29-funplay-pos-design.md` §6.2–6.4, §6.8, §7, §8.4, §9)

## Global Constraints

- Uang = integer Rupiah (`Int`); tidak ada float yang disimpan atau dikirim sebagai nilai uang. Persen = integer 0–100.
- Kalkulator total bill tunggal di `packages/shared` — dipakai pratinjau UI dan angka final server. Urutan: subtotal → diskon item → diskon bill → service → pajak.
- Bahasa UI dan pesan error: Indonesia. Mata uang: Rupiah.
- **Satu shift terbuka untuk seluruh outlet.** Shift wajib untuk: memulai sesi, menambah/mengubah item, membuat tagihan lepas, checkout. Stop, pause/resume, extend, pindah, kontrol lampu **tidak** butuh shift. Tanpa shift → 409 `NO_OPEN_SHIFT`.
- Split payment dikirim **dalam satu request** dengan satu idempotency key; lunas semua atau gagal semua. Tidak ada status "sebagian dibayar".
- PIN supervisor untuk KASIR: hapus item / kurangi qty item tersimpan, batalkan bill OPEN bertagihan > 0, diskon total di atas `discountApprovalPct` % subtotal, void bill PAID. Persetujuan dicatat di `AuditLog.approvedById` lewat `approveWithPin` (M1).
- Default: `discountApprovalPct = 10`, `taxPct = 0`, `servicePct = 0`, cakupan pajak & service `ALL`, footer struk `"Terima kasih!"`, printer `SIMULATOR`.
- Tidak ada pembulatan tunai; total dibayar persis. Kembalian hanya dari tunai.
- Stok berkurang saat bill dibayar; penjualan tetap boleh saat stok ≤ 0.
- Nomor bill tetap `FP-YYYYMMDD-NNNN` (`nextBillNumber` M1).
- Struk 80 mm = **48 kolom** font A; driver LAN = raw TCP port 9100, timeout 5 detik. Kegagalan cetak tidak pernah membatalkan atau menggandakan pembayaran.
- Jangan pakai `crypto.randomUUID()` di browser — pakai `newId()` dari `apps/web/src/lib/id.ts` (juga untuk idempotency key).
- Jangan menjalankan `prisma migrate reset`/`migrate dev` (diblokir untuk agen & bisa mereset DB dev). Migrasi dibuat dengan `prisma migrate diff` lalu diterapkan dengan `prisma migrate deploy`. Jangan menyentuh DB dev `funplay`.

## Review Focus

1. **Bayar ganda** — double-click Bayar atau dua perangkat membayar bill yang sama → tepat satu set pembayaran; key sama mengembalikan hasil yang sama (Task 8, test "checkout paralel" & "idempotency").
2. **Angka pratinjau ≠ angka server** — item ditambah dari perangkat lain saat dialog checkout terbuka → 409 `TOTAL_CHANGED`, bukan bayar dengan total lama (Task 8, test "TOTAL_CHANGED"); invarian `subtotal − discountTotal + serviceTotal + taxTotal = grandTotal` untuk input acak (Task 1).
3. **Stop tanpa bayar lalu ganti shift** — bill OPEN dari shift lama dibayar di shift baru → pembayaran masuk shift baru, rekap kedua shift benar (Task 8, test "bayar setelah ganti shift").
4. **Void mengembalikan stok tepat sekali** — void dua kali / paralel → satu `StockMovement` VOID, stok kembali sekali, kas seharusnya shift berkurang (Task 8, test "void").
5. **Printer gagal** — printer LAN tidak merespons → pembayaran tetap PAID, `PrintJob` FAILED, cetak ulang menghasilkan job baru tanpa pembayaran baru (Task 9, test "printer gagal").

## Persiapan

Branch kerja: `feat/m2-transaksi` (sudah dibuat dari `feat/m1-fondasi-meja`). DB `funplay_test` dan `funplay_e2e` sudah ada (M1). `pnpm` ada di `~/.nvm/versions/node/v22.*/bin`.

## Struktur File (dikunci oleh plan ini)

```
packages/shared/src/
  transactions.ts          konstanta & DTO M2 (metode bayar, status bill, view bill/shift/produk/print)
  billing/bill-totals.ts   computeBillTotals, lineScope, discountAmount, discountPct
  billing/payment.ts       checkPayments
  receipt/receipt.ts       PrintLine, renderReceipt, renderShiftReport, toPlainText, formatAmount
  receipt/escpos.ts        encodeEscPos
apps/server/
  prisma/schema.prisma, prisma/migrations/<ts>_m2_transaksi/migration.sql
  src/modules/shifts/{shifts.service,shifts.routes}.ts
  src/modules/catalog/{categories.routes,products.routes}.ts
  src/modules/billing/{bill-view,bills.service,bills.routes,checkout.service,checkout.routes}.ts
  src/modules/printing/{printer,receipt-model,print.service,printing.routes}.ts
  test/{shifts,products,bills,checkout,printing}.test.ts
apps/web/src/
  lib/{money,events}.ts
  hooks/{useShift,useBill}.ts
  features/shift/{ShiftChip,OpenShiftDialog,ShiftPage}.tsx
  features/products/ProductsPage.tsx
  features/settings/{TransactionSettings,PrinterSettings}.tsx
  features/orders/{BillItems,OrderDialog,UnpaidStrip,NewBillButton}.tsx
  features/checkout/{CheckoutDialog,PaymentComposer,MergeDialog,DiscountEditor}.tsx
  features/transactions/{TransactionsPage,BillDetail}.tsx
  features/printing/PrinterSimulatorPanel.tsx
e2e/transaksi.spec.ts
```

---
### Task 1: Konstanta & DTO transaksi + kalkulator total bill (`shared`)

**Files:**
- Create: `packages/shared/src/transactions.ts`, `packages/shared/src/billing/bill-totals.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/billing/bill-totals.test.ts`

**Interfaces:**
- Consumes: `ChargeLine` (`billing/charge.ts`), `SessionView` (`views.ts`).
- Produces (dipakai semua task berikutnya):
  - konstanta + tipe: `PAYMENT_METHODS`/`PaymentMethod`, `PAYMENT_METHOD_LABEL`, `BILL_STATUSES`/`BillStatus`, `BILL_STATUS_LABEL`, `LINE_TYPES`/`LineType`, `PRODUCT_KINDS`/`ProductKind`, `SCOPES`/`Scope`, `DISCOUNT_TYPES`/`DiscountType`, `PRINTER_DRIVERS`/`PrinterDriver`, `Discount`;
  - DTO: `CategoryDto`, `ProductDto`, `BillLineView`, `BillSessionView`, `PaymentView`, `BillView`, `BillSummary`, `ShiftView`, `ShiftSummary`, `PrintJobView`, `CheckoutResult`;
  - `lineScope(type: LineType): LineScope`, `discountAmount(base, d)`, `allocate(total, weights)`, `computeBillTotals(lines: TotalsLineInput[], billDiscount: Discount | null, s: TotalsSettings): BillTotals`, `needsDiscountApproval(t: BillTotals, pct: number): boolean`.

- [ ] **Step 1: Tulis `transactions.ts` (tipe murni, tanpa logika)**

```ts
import type { ChargeLine } from './billing/charge';
import type { SessionView } from './views';

export const PAYMENT_METHODS = ['CASH', 'QRIS', 'CARD', 'TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { CASH: 'Tunai', QRIS: 'QRIS', CARD: 'Kartu', TRANSFER: 'Transfer' };

export const BILL_STATUSES = ['OPEN', 'PAID', 'VOID', 'CANCELLED'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
export const BILL_STATUS_LABEL: Record<BillStatus, string> = { OPEN: 'Belum dibayar', PAID: 'Lunas', VOID: 'Void', CANCELLED: 'Dibatalkan' };

export const LINE_TYPES = ['TIME', 'PRODUCT', 'SERVICE', 'CUSTOM'] as const;
export type LineType = (typeof LINE_TYPES)[number];

export const PRODUCT_KINDS = ['STOCK', 'SERVICE'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** Cakupan pajak/service: NONE = nonaktif, BILLING = biaya waktu, FNB = produk/layanan/manual, ALL = semuanya. */
export const SCOPES = ['NONE', 'BILLING', 'FNB', 'ALL'] as const;
export type Scope = (typeof SCOPES)[number];

export const DISCOUNT_TYPES = ['AMOUNT', 'PERCENT'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];
export interface Discount {
  type: DiscountType;
  /** Rupiah untuk AMOUNT, 0–100 untuk PERCENT. */
  value: number;
}

export const PRINTER_DRIVERS = ['SIMULATOR', 'USB', 'LAN'] as const;
export type PrinterDriver = (typeof PRINTER_DRIVERS)[number];

export interface CategoryDto { id: string; name: string; color: string; sortOrder: number; active: boolean }
export interface ProductDto { id: string; name: string; categoryId: string; kind: ProductKind; price: number; stockQty: number; active: boolean }

export interface BillLineView {
  id: string;
  type: LineType;
  productId: string | null;
  sessionId: string | null;
  name: string;
  unitPrice: number;
  qty: number;
  discount: Discount | null;
  /** Rincian per tarif untuk baris TIME. */
  breakdown: ChargeLine[] | null;
}

/** Sesi yang masih aktif di bill (biaya waktunya dihitung langsung di klien). */
export interface BillSessionView extends SessionView { unitName: string }

export interface PaymentView {
  id: string;
  method: PaymentMethod;
  amount: number;
  received: number | null;
  change: number | null;
  reference: string | null;
  createdAt: string;
}

export interface BillView {
  id: string;
  number: string;
  label: string;
  status: BillStatus;
  createdAt: string;
  createdByName: string;
  billDiscount: Discount | null;
  lines: BillLineView[];
  activeSessions: BillSessionView[];
  payments: PaymentView[];
  /** Angka tersimpan saat PAID (juga VOID). null selama OPEN/CANCELLED — klien menghitung sendiri. */
  stored: { subtotal: number; discountTotal: number; serviceTotal: number; taxTotal: number; grandTotal: number } | null;
  paidAt: string | null;
  paidByName: string | null;
  shiftId: string | null;
  mergedIntoId: string | null;
  cancelReason: string | null;
  voidReason: string | null;
  voidedAt: string | null;
}

export interface BillSummary {
  id: string;
  number: string;
  label: string;
  status: BillStatus;
  createdAt: string;
  paidAt: string | null;
  /** PAID/VOID: total tersimpan. OPEN: total baris tersimpan (tanpa sesi berjalan). */
  total: number;
  hasActiveSession: boolean;
}

export interface ShiftView {
  id: string;
  openedAt: string;
  openedByName: string;
  openingCash: number;
  closedAt: string | null;
  closedByName: string | null;
  countedCash: number | null;
  expectedCash: number | null;
  note: string | null;
}

export interface ShiftSummary {
  shift: ShiftView;
  /** Jumlah pembayaran (bagian tagihan) per metode di shift ini. */
  sales: Record<PaymentMethod, number>;
  /** Pembayaran bill yang di-void selama shift ini, per metode. */
  voids: Record<PaymentMethod, number>;
  billCount: number;
  voidCount: number;
  expectedCash: number;
}

export interface PrintJobView {
  id: string;
  kind: 'RECEIPT' | 'SHIFT_REPORT' | 'TEST';
  status: 'PENDING' | 'DONE' | 'FAILED';
  error: string | null;
  previewText: string;
  billId: string | null;
  shiftId: string | null;
  createdAt: string;
}

export interface CheckoutResult { bill: BillView; change: number }
```

- [ ] **Step 2: Tulis test yang gagal**

`packages/shared/src/billing/bill-totals.test.ts`:
```ts
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
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/shared test -- bill-totals`
Expected: FAIL — modul `./bill-totals` tidak ditemukan.

- [ ] **Step 4: Implementasi**

`packages/shared/src/billing/bill-totals.ts`:
```ts
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
```

Tambahkan di `packages/shared/src/index.ts`:
```ts
export * from './transactions';
export * from './billing/bill-totals';
```

- [ ] **Step 5: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/shared test && pnpm --filter @funplay/shared typecheck`
Expected: PASS (semua test lama + baru).

- [ ] **Step 6: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): transaction types and bill totals calculator"
```

---

### Task 2: Validasi pembayaran (`shared`)

**Files:**
- Create: `packages/shared/src/billing/payment.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/billing/payment.test.ts`

**Interfaces:**
- Consumes: `PaymentMethod` (Task 1).
- Produces: `PaymentInput { method; amount; received?: number | null; reference?: string | null }`, `PaymentCheck` (`{ ok: true; paid; change; payments: CheckedPayment[] } | { ok: false; code: 'PAYMENT_INSUFFICIENT' | 'PAYMENT_INVALID'; message }`), `CheckedPayment` (PaymentInput + `received: number | null`, `change: number | null`), `checkPayments(grandTotal, payments)`, `cashPayment(remaining, received): PaymentInput`.

Arti `amount`: bagian tagihan yang ditutup metode itu. Untuk tunai, `received` = uang yang diserahkan pelanggan (≥ amount) dan `change = received − amount`. Jumlah `amount` harus **tepat** sama dengan `grandTotal`.

- [ ] **Step 1: Tulis test yang gagal**

`packages/shared/src/billing/payment.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { cashPayment, checkPayments } from './payment';

describe('checkPayments', () => {
  it('tunai dengan kembalian', () => {
    const r = checkPayments(79920, [{ method: 'CASH', amount: 79920, received: 100000 }]);
    expect(r).toEqual({ ok: true, paid: 79920, change: 20080, payments: [{ method: 'CASH', amount: 79920, received: 100000, change: 20080, reference: null }] });
  });

  it('split tunai + QRIS', () => {
    const r = checkPayments(80000, [
      { method: 'CASH', amount: 50000, received: 50000 },
      { method: 'QRIS', amount: 30000, reference: 'ABC123' },
    ]);
    expect(r).toMatchObject({ ok: true, paid: 80000, change: 0 });
    if (r.ok) expect(r.payments[1]).toEqual({ method: 'QRIS', amount: 30000, received: null, change: null, reference: 'ABC123' });
  });

  it('tunai tanpa received = uang pas', () => {
    expect(checkPayments(15000, [{ method: 'CASH', amount: 15000 }])).toMatchObject({ ok: true, change: 0 });
  });

  it('kurang bayar → PAYMENT_INSUFFICIENT', () => {
    expect(checkPayments(80000, [{ method: 'CARD', amount: 50000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INSUFFICIENT' });
  });

  it('jumlah bagian melebihi total → PAYMENT_INVALID', () => {
    expect(checkPayments(80000, [{ method: 'CASH', amount: 50000 }, { method: 'QRIS', amount: 40000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });

  it('kembalian dari non-tunai ditolak', () => {
    expect(checkPayments(10000, [{ method: 'QRIS', amount: 10000, received: 20000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });

  it('uang diterima kurang dari bagian tunai ditolak', () => {
    expect(checkPayments(10000, [{ method: 'CASH', amount: 10000, received: 5000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });

  it('nominal 0, negatif, atau pecahan ditolak', () => {
    expect(checkPayments(10000, [{ method: 'CASH', amount: 0 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
    expect(checkPayments(10000, [{ method: 'CARD', amount: 10000.5 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });

  it('total 0 boleh tanpa pembayaran', () => {
    expect(checkPayments(0, [])).toEqual({ ok: true, paid: 0, change: 0, payments: [] });
    expect(checkPayments(5000, [])).toMatchObject({ ok: false, code: 'PAYMENT_INSUFFICIENT' });
  });
});

describe('cashPayment', () => {
  it('bagian = min(uang diterima, sisa)', () => {
    expect(cashPayment(30000, 50000)).toEqual({ method: 'CASH', amount: 30000, received: 50000 });
    expect(cashPayment(30000, 20000)).toEqual({ method: 'CASH', amount: 20000, received: 20000 });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/shared test -- payment`
Expected: FAIL — modul `./payment` tidak ditemukan.

- [ ] **Step 3: Implementasi**

`packages/shared/src/billing/payment.ts`:
```ts
import type { PaymentMethod } from '../transactions';

export interface PaymentInput {
  method: PaymentMethod;
  /** Bagian tagihan yang ditutup metode ini. */
  amount: number;
  /** Tunai saja: uang yang diserahkan pelanggan (≥ amount). Kosong = uang pas. */
  received?: number | null;
  reference?: string | null;
}
export interface CheckedPayment { method: PaymentMethod; amount: number; received: number | null; change: number | null; reference: string | null }
export type PaymentCheck =
  | { ok: true; paid: number; change: number; payments: CheckedPayment[] }
  | { ok: false; code: 'PAYMENT_INSUFFICIENT' | 'PAYMENT_INVALID'; message: string };

const invalid = (message: string): PaymentCheck => ({ ok: false, code: 'PAYMENT_INVALID', message });
const isPositiveInt = (n: number) => Number.isInteger(n) && n > 0;

export function checkPayments(grandTotal: number, payments: PaymentInput[]): PaymentCheck {
  const checked: CheckedPayment[] = [];
  for (const p of payments) {
    if (!isPositiveInt(p.amount)) return invalid('Nominal pembayaran harus bilangan bulat lebih dari 0');
    const reference = p.reference?.trim() || null;
    if (p.method !== 'CASH') {
      if (p.received != null) return invalid('Kembalian hanya untuk pembayaran tunai');
      checked.push({ method: p.method, amount: p.amount, received: null, change: null, reference });
      continue;
    }
    const received = p.received ?? p.amount;
    if (!Number.isInteger(received) || received < p.amount) return invalid('Uang diterima kurang dari nominal tunai');
    checked.push({ method: 'CASH', amount: p.amount, received, change: received - p.amount, reference });
  }
  const paid = checked.reduce((a, p) => a + p.amount, 0);
  if (paid > grandTotal) return invalid('Pembayaran melebihi total tagihan');
  if (paid < grandTotal) return { ok: false, code: 'PAYMENT_INSUFFICIENT', message: 'Pembayaran belum mencukupi total tagihan' };
  return { ok: true, paid, change: checked.reduce((a, p) => a + (p.change ?? 0), 0), payments: checked };
}

/** Tunai yang diserahkan pelanggan → bagian tagihan yang ditutup (sisanya jadi kembalian). */
export function cashPayment(remaining: number, received: number): PaymentInput {
  return { method: 'CASH', amount: Math.min(received, remaining), received };
}
```

Tambahkan di `index.ts`: `export * from './billing/payment';`

- [ ] **Step 4: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/shared test && pnpm --filter @funplay/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): payment validation for split payments"
```

---

### Task 3: Renderer struk & encoder ESC/POS (`shared`)

**Files:**
- Create: `packages/shared/src/receipt/receipt.ts`, `packages/shared/src/receipt/escpos.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/src/receipt/receipt.test.ts`, `packages/shared/src/receipt/escpos.test.ts`

**Interfaces:**
- Produces: `RECEIPT_WIDTH = 48`, `PrintLine { text; align?: 'left'|'center'|'right'; bold?; tall? }`, `formatAmount(n): string` (`1.250.000`), `formatReceiptDate(at: Date, utcOffsetMin): string` (`01/10/2026 14:05`), `twoCols(left, right): string`, `ReceiptModel`, `renderReceipt(m): PrintLine[]`, `ShiftReportModel`, `renderShiftReport(m): PrintLine[]`, `renderTestPage(outletName, at): PrintLine[]`, `toPlainText(lines): string`, `encodeEscPos(lines, opts?): Uint8Array`.

- [ ] **Step 1: Tulis test yang gagal**

`packages/shared/src/receipt/receipt.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatAmount, formatReceiptDate, RECEIPT_WIDTH, renderReceipt, renderShiftReport, toPlainText, twoCols, type ReceiptModel } from './receipt';

const model: ReceiptModel = {
  outletName: 'FunPlay Billiard',
  address: 'Jl. Contoh No. 1',
  header: 'IG @funplay',
  footer: 'Terima kasih!\nSampai jumpa',
  billNumber: 'FP-20261001-0001',
  printedAt: '01/10/2026 14:05',
  cashier: 'Kasir',
  label: 'Meja 1',
  sessions: [{ unitName: 'Meja 1', start: '10:00', end: '12:00' }],
  lines: [
    { name: 'Meja 1 - Open billing', qty: 1, unitPrice: 80000, amount: 80000, discount: 0, details: ['Reguler Siang 2 jam'] },
    { name: 'Es Teh Manis Jumbo Spesial Pakai Nama Sangat Panjang Sekali', qty: 2, unitPrice: 8000, amount: 16000, discount: 1600, details: [] },
  ],
  subtotal: 96000,
  discountTotal: 1600,
  serviceTotal: 0,
  taxTotal: 0,
  grandTotal: 94400,
  payments: [{ label: 'Tunai', amount: 94400 }],
  change: 5600,
  copy: null,
};

describe('format', () => {
  it('formatAmount memakai titik ribuan', () => {
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(1250000)).toBe('1.250.000');
    expect(formatAmount(-5000)).toBe('-5.000');
  });
  it('formatReceiptDate memakai offset outlet', () => {
    expect(formatReceiptDate(new Date('2026-10-01T07:05:00Z'), 420)).toBe('01/10/2026 14:05');
  });
  it('twoCols rata kanan, kiri dipotong agar muat 48 kolom', () => {
    expect(twoCols('TOTAL', '94.400')).toBe('TOTAL' + ' '.repeat(48 - 5 - 6) + '94.400');
    const long = twoCols('x'.repeat(60), '1.000');
    expect(long).toHaveLength(48);
    expect(long.endsWith(' 1.000')).toBe(true);
  });
});

describe('renderReceipt', () => {
  const lines = renderReceipt(model);
  const text = toPlainText(lines);

  it('tidak ada baris melebihi 48 kolom', () => {
    for (const l of lines) expect(l.text.length).toBeLessThanOrEqual(RECEIPT_WIDTH);
    for (const l of text.split('\n')) expect(l.length).toBeLessThanOrEqual(RECEIPT_WIDTH);
  });

  it('memuat header, nomor bill, rincian, total, pembayaran, kembalian, footer', () => {
    expect(lines[0]).toEqual({ text: 'FunPlay Billiard', align: 'center', bold: true, tall: true });
    expect(text).toContain('No. FP-20261001-0001');
    expect(text).toContain('Meja 1 10:00-12:00');
    expect(text).toContain(twoCols('Meja 1 - Open billing', '80.000'));
    expect(text).toContain('  Reguler Siang 2 jam');
    expect(text).toContain(twoCols('  2 x 8.000', '16.000'));
    expect(text).toContain(twoCols('  Diskon', '-1.600'));
    expect(lines).toContainEqual({ text: twoCols('TOTAL', '94.400'), bold: true, tall: true });
    expect(text).toContain(twoCols('Tunai', '94.400'));
    expect(text).toContain(twoCols('Kembalian', '5.600'));
    expect(text).toContain('Sampai jumpa');
    expect(text).not.toContain('Service');
  });

  it('cetak ulang dan void diberi tanda', () => {
    expect(toPlainText(renderReceipt({ ...model, copy: 'REPRINT' }))).toContain('** CETAK ULANG **');
    expect(toPlainText(renderReceipt({ ...model, copy: 'VOID' }))).toContain('** VOID **');
  });
});

describe('renderShiftReport', () => {
  it('memuat kas awal, penjualan per metode, kas seharusnya, dihitung, selisih', () => {
    const text = toPlainText(
      renderShiftReport({
        outletName: 'FunPlay', openedAt: '01/10/2026 08:00', closedAt: '01/10/2026 16:00', openedBy: 'Andi', closedBy: 'Andi',
        openingCash: 200000, sales: [{ label: 'Tunai', amount: 300000 }, { label: 'QRIS', amount: 50000 }],
        voids: [{ label: 'Tunai', amount: 20000 }], billCount: 12, voidCount: 1,
        expectedCash: 480000, countedCash: 475000, note: 'kurang receh',
      }),
    );
    expect(text).toContain('REKAP SHIFT');
    expect(text).toContain(twoCols('Kas awal', '200.000'));
    expect(text).toContain(twoCols('  Tunai', '300.000'));
    expect(text).toContain(twoCols('  QRIS', '50.000'));
    expect(text).toContain(twoCols('Kas seharusnya', '480.000'));
    expect(text).toContain(twoCols('Kas dihitung', '475.000'));
    expect(text).toContain(twoCols('Selisih', '-5.000'));
    expect(text).toContain('kurang receh');
  });
});
```

`packages/shared/src/receipt/escpos.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { encodeEscPos } from './escpos';

const bytes = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const indexOfSeq = (hay: number[], needle: number[]) => hay.findIndex((_, i) => needle.every((n, j) => hay[i + j] === n));

describe('encodeEscPos', () => {
  const out = Array.from(encodeEscPos([{ text: 'FunPlay', align: 'center', bold: true, tall: true }, { text: 'Café 1' }]));

  it('diawali init dan diakhiri feed + cut', () => {
    expect(out.slice(0, 2)).toEqual([0x1b, 0x40]);
    expect(out.slice(-4)).toEqual([0x1d, 0x56, 0x42, 0x00]);
    expect(indexOfSeq(out, [0x1b, 0x64, 4])).toBeGreaterThan(0);
  });

  it('mengatur rata tengah, tebal, dan tinggi ganda sebelum teks', () => {
    const at = indexOfSeq(out, bytes('FunPlay'));
    expect(out.slice(at - 9, at)).toEqual([0x1b, 0x61, 1, 0x1b, 0x45, 1, 0x1d, 0x21, 0x01]);
  });

  it('karakter non-ASCII diganti "?"', () => {
    expect(indexOfSeq(out, bytes('Caf? 1'))).toBeGreaterThan(0);
  });

  it('tanpa potong kertas bila cut=false', () => {
    const noCut = Array.from(encodeEscPos([{ text: 'x' }], { cut: false }));
    expect(indexOfSeq(noCut, [0x1d, 0x56])).toBe(-1);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/shared test -- receipt escpos`
Expected: FAIL — modul tidak ditemukan.

- [ ] **Step 3: Implementasi**

`packages/shared/src/receipt/receipt.ts`:
```ts
export const RECEIPT_WIDTH = 48;

export interface PrintLine {
  text: string;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  /** Tinggi ganda (lebar tetap 48 kolom). */
  tall?: boolean;
}

export function formatAmount(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + Math.abs(Math.round(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export function formatReceiptDate(at: Date, utcOffsetMin: number): string {
  const d = new Date(at.getTime() + utcOffsetMin * 60_000);
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

const cut = (s: string, w = RECEIPT_WIDTH) => (s.length > w ? s.slice(0, w) : s);

/** Teks kiri + angka rata kanan dalam 48 kolom; teks kiri dipotong bila terlalu panjang. */
export function twoCols(left: string, right: string): string {
  const room = RECEIPT_WIDTH - right.length - 1;
  const l = left.length > room ? left.slice(0, room) : left;
  return l + ' '.repeat(RECEIPT_WIDTH - l.length - right.length) + right;
}

const rule = (): PrintLine => ({ text: '-'.repeat(RECEIPT_WIDTH) });
const center = (text: string, extra: Partial<PrintLine> = {}): PrintLine => ({ text: cut(text), align: 'center', ...extra });
const multiline = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

export interface ReceiptModel {
  outletName: string;
  address: string;
  header: string;
  footer: string;
  billNumber: string;
  printedAt: string;
  cashier: string;
  label: string;
  sessions: { unitName: string; start: string; end: string }[];
  lines: { name: string; qty: number; unitPrice: number; amount: number; discount: number; details: string[] }[];
  subtotal: number;
  discountTotal: number;
  serviceTotal: number;
  taxTotal: number;
  grandTotal: number;
  payments: { label: string; amount: number }[];
  change: number;
  copy: 'REPRINT' | 'VOID' | null;
}

export function renderReceipt(m: ReceiptModel): PrintLine[] {
  const out: PrintLine[] = [center(m.outletName, { bold: true, tall: true })];
  if (m.address.trim()) out.push(center(m.address.trim()));
  for (const h of multiline(m.header)) out.push(center(h));
  out.push(rule());
  if (m.copy === 'REPRINT') out.push(center('** CETAK ULANG **', { bold: true }));
  if (m.copy === 'VOID') out.push(center('** VOID **', { bold: true }));
  out.push({ text: cut(`No. ${m.billNumber}`) }, { text: cut(`Tanggal ${m.printedAt}`) }, { text: cut(`Kasir ${m.cashier}`) });
  if (m.label) out.push({ text: cut(m.label) });
  for (const s of m.sessions) out.push({ text: cut(`${s.unitName} ${s.start}-${s.end}`) });
  out.push(rule());

  for (const l of m.lines) {
    if (l.qty === 1) out.push({ text: twoCols(l.name, formatAmount(l.amount)) });
    else out.push({ text: cut(l.name) }, { text: twoCols(`  ${l.qty} x ${formatAmount(l.unitPrice)}`, formatAmount(l.amount)) });
    for (const d of l.details) out.push({ text: cut(`  ${d}`) });
    if (l.discount > 0) out.push({ text: twoCols('  Diskon', `-${formatAmount(l.discount)}`) });
  }
  out.push(rule());
  out.push({ text: twoCols('Subtotal', formatAmount(m.subtotal)) });
  if (m.discountTotal > 0) out.push({ text: twoCols('Total diskon', `-${formatAmount(m.discountTotal)}`) });
  if (m.serviceTotal > 0) out.push({ text: twoCols('Service', formatAmount(m.serviceTotal)) });
  if (m.taxTotal > 0) out.push({ text: twoCols('Pajak', formatAmount(m.taxTotal)) });
  out.push({ text: twoCols('TOTAL', formatAmount(m.grandTotal)), bold: true, tall: true });
  out.push(rule());
  for (const p of m.payments) out.push({ text: twoCols(p.label, formatAmount(p.amount)) });
  if (m.change > 0) out.push({ text: twoCols('Kembalian', formatAmount(m.change)) });
  const footer = multiline(m.footer);
  if (footer.length) {
    out.push(rule());
    for (const f of footer) out.push(center(f));
  }
  return out;
}

export interface ShiftReportModel {
  outletName: string;
  openedAt: string;
  closedAt: string;
  openedBy: string;
  closedBy: string;
  openingCash: number;
  sales: { label: string; amount: number }[];
  voids: { label: string; amount: number }[];
  billCount: number;
  voidCount: number;
  expectedCash: number;
  countedCash: number;
  note: string | null;
}

export function renderShiftReport(m: ShiftReportModel): PrintLine[] {
  const out: PrintLine[] = [center('REKAP SHIFT', { bold: true, tall: true }), center(m.outletName), rule()];
  out.push(
    { text: cut(`Buka  ${m.openedAt} (${m.openedBy})`) },
    { text: cut(`Tutup ${m.closedAt} (${m.closedBy})`) },
    rule(),
    { text: twoCols('Kas awal', formatAmount(m.openingCash)) },
    { text: 'Penjualan', bold: true },
  );
  for (const s of m.sales) out.push({ text: twoCols(`  ${s.label}`, formatAmount(s.amount)) });
  if (m.voids.length) {
    out.push({ text: 'Void', bold: true });
    for (const v of m.voids) out.push({ text: twoCols(`  ${v.label}`, `-${formatAmount(v.amount)}`) });
  }
  out.push(
    { text: twoCols('Jumlah bill', String(m.billCount)) },
    { text: twoCols('Jumlah void', String(m.voidCount)) },
    rule(),
    { text: twoCols('Kas seharusnya', formatAmount(m.expectedCash)) },
    { text: twoCols('Kas dihitung', formatAmount(m.countedCash)) },
    { text: twoCols('Selisih', formatAmount(m.countedCash - m.expectedCash)), bold: true },
  );
  if (m.note?.trim()) out.push(rule(), { text: cut(`Catatan: ${m.note.trim()}`) });
  return out;
}

export function renderTestPage(outletName: string, at: string): PrintLine[] {
  return [center(outletName, { bold: true, tall: true }), center('TES CETAK'), center(at), rule(), { text: twoCols('Kiri', 'Kanan') }, rule()];
}

/** Pratinjau teks: rata tengah/kanan diterapkan dengan spasi, 48 kolom. */
export function toPlainText(lines: PrintLine[]): string {
  return lines
    .map((l) => {
      const t = cut(l.text);
      if (l.align === 'center') return ' '.repeat(Math.floor((RECEIPT_WIDTH - t.length) / 2)) + t;
      if (l.align === 'right') return t.padStart(RECEIPT_WIDTH);
      return t;
    })
    .join('\n');
}
```

`packages/shared/src/receipt/escpos.ts`:
```ts
import type { PrintLine } from './receipt';

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Byte ESC/POS untuk printer thermal 80 mm (font A, 48 kolom). Karakter non-ASCII diganti "?". */
export function encodeEscPos(lines: PrintLine[], opts: { feed?: number; cut?: boolean } = {}): Uint8Array {
  const out: number[] = [ESC, 0x40];
  for (const l of lines) {
    out.push(ESC, 0x61, l.align === 'center' ? 1 : l.align === 'right' ? 2 : 0);
    out.push(ESC, 0x45, l.bold ? 1 : 0);
    out.push(GS, 0x21, l.tall ? 0x01 : 0x00);
    for (const ch of l.text) {
      const c = ch.charCodeAt(0);
      out.push(c >= 0x20 && c < 0x7f ? c : 0x3f);
    }
    out.push(LF);
  }
  out.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0x00);
  out.push(ESC, 0x64, opts.feed ?? 4);
  if (opts.cut ?? true) out.push(GS, 0x56, 0x42, 0x00);
  return Uint8Array.from(out);
}
```

Tambahkan di `index.ts`:
```ts
export * from './receipt/receipt';
export * from './receipt/escpos';
```

- [ ] **Step 4: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/shared test && pnpm --filter @funplay/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): 48-column receipt renderer and ESC/POS encoder"
```

---
### Task 4: Skema Prisma M2 + pengaturan transaksi

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20261001090000_m2_transaksi/migration.sql` (dihasilkan `prisma migrate diff`)
- Modify: `packages/shared/src/transactions.ts`, `packages/shared/src/views.ts`
- Modify: `apps/server/src/modules/settings/settings.service.ts`
- Modify (fixture `PublicSettings`): `apps/web/src/stores/board.test.ts`, `apps/web/src/features/board/UnitCard.test.tsx`, `apps/web/src/features/board/UnitPanel.test.tsx`
- Test: `apps/server/test/settings-users.test.ts`

**Interfaces:**
- Consumes: `Scope`, `PrinterDriver`, `SCOPES`, `PRINTER_DRIVERS` (Task 1).
- Produces:
  - `TransactionSettings` + `DEFAULT_TRANSACTION_SETTINGS` (shared); `PublicSettings extends TransactionSettings`.
  - Model Prisma: `Category`, `Product`, `BillLine`, `Payment`, `Shift`, `StockMovement`, `PrintJob`; `Bill` diperluas; enum `Scope`, `ProductKind`, `LineType`, `DiscountType`, `PaymentMethod`, `StockReason`, `PrintKind`, `PrintStatus`; `BillStatus` + `CANCELLED`.
  - Field `Setting`: `taxPct`, `taxScope`, `servicePct`, `serviceScope`, `discountApprovalPct`, `receiptHeader`, `receiptFooter`, `printerDriver`, `printerDevicePath`, `printerHost`, `printerPort`.

Catatan desain: spec menyebut `printerConfig (JSON)`; plan ini memakai empat kolom datar (`printerDriver`, `printerDevicePath`, `printerHost`, `printerPort`) agar tervalidasi tipe — isinya sama.

- [ ] **Step 1: Tambah tipe pengaturan di shared**

Tambahkan ke akhir `packages/shared/src/transactions.ts`:
```ts
export interface TransactionSettings {
  taxPct: number;
  taxScope: Scope;
  servicePct: number;
  serviceScope: Scope;
  /** Diskon total di atas persen subtotal ini butuh PIN supervisor (kasir). */
  discountApprovalPct: number;
  receiptHeader: string;
  receiptFooter: string;
  printerDriver: PrinterDriver;
  printerDevicePath: string;
  printerHost: string;
  printerPort: number;
}

export const DEFAULT_TRANSACTION_SETTINGS: TransactionSettings = {
  taxPct: 0,
  taxScope: 'ALL',
  servicePct: 0,
  serviceScope: 'ALL',
  discountApprovalPct: 10,
  receiptHeader: '',
  receiptFooter: 'Terima kasih!',
  printerDriver: 'SIMULATOR',
  printerDevicePath: '/dev/usb/lp0',
  printerHost: '',
  printerPort: 9100,
};
```

Di `packages/shared/src/views.ts`: tambah `import type { TransactionSettings } from './transactions';` dan ubah deklarasi menjadi `export interface PublicSettings extends TransactionSettings {` (field M1 tetap).

Di tiga fixture web (`stores/board.test.ts`, `UnitCard.test.tsx`, `UnitPanel.test.tsx`) setiap objek `settings: { outletType: ..., autoOffUnexpected: false }` ditambah `...DEFAULT_TRANSACTION_SETTINGS` (import dari `@funplay/shared`).

- [ ] **Step 2: Tulis test yang gagal**

Di `apps/server/test/settings-users.test.ts`, ganti ekspektasi test `'GET mengembalikan default'` menjadi:
```ts
    expect(res.json()).toEqual({
      outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15,
      minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false,
      taxPct: 0, taxScope: 'ALL', servicePct: 0, serviceScope: 'ALL', discountApprovalPct: 10,
      receiptHeader: '', receiptFooter: 'Terima kasih!',
      printerDriver: 'SIMULATOR', printerDevicePath: '/dev/usb/lp0', printerHost: '', printerPort: 9100,
    });
```
dan tambahkan di `describe('settings', ...)`:
```ts
  it('owner mengatur pajak, service, struk, dan printer', async () => {
    const cookie = await loginAs(t.app, 'owner');
    const payload = {
      taxPct: 11, taxScope: 'FNB', servicePct: 5, serviceScope: 'ALL', discountApprovalPct: 20,
      receiptHeader: 'IG @funplay', receiptFooter: 'Sampai jumpa', printerDriver: 'LAN', printerHost: '192.168.1.50', printerPort: 9100,
    };
    const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject(payload);
  });

  it('persen di luar 0–100 dan cakupan tak dikenal ditolak', async () => {
    const cookie = await loginAs(t.app, 'owner');
    for (const payload of [{ taxPct: 101 }, { servicePct: -1 }, { taxScope: 'SEMUA' }, { printerDriver: 'BLUETOOTH' }, { printerPort: 70000 }]) {
      const res = await t.app.inject({ method: 'PUT', url: '/api/settings', headers: { cookie }, payload });
      expect(res.statusCode).toBe(400);
    }
  });
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- settings-users`
Expected: FAIL — field baru tidak ada di respons.

- [ ] **Step 4: Ubah skema Prisma**

Di `apps/server/prisma/schema.prisma`:

1. Ganti `enum BillStatus` dan tambahkan enum baru:
```prisma
enum BillStatus {
  OPEN
  PAID
  VOID
  CANCELLED
}

enum Scope {
  NONE
  BILLING
  FNB
  ALL
}

enum ProductKind {
  STOCK
  SERVICE
}

enum LineType {
  TIME
  PRODUCT
  SERVICE
  CUSTOM
}

enum DiscountType {
  AMOUNT
  PERCENT
}

enum PaymentMethod {
  CASH
  QRIS
  CARD
  TRANSFER
}

enum StockReason {
  SALE
  VOID
}

enum PrintKind {
  RECEIPT
  SHIFT_REPORT
  TEST
}

enum PrintStatus {
  PENDING
  DONE
  FAILED
}
```

2. Di `model Setting`, sebelum `updatedAt`, tambahkan:
```prisma
  taxPct              Int      @default(0)
  taxScope            Scope    @default(ALL)
  servicePct          Int      @default(0)
  serviceScope        Scope    @default(ALL)
  discountApprovalPct Int      @default(10)
  receiptHeader       String   @default("")
  receiptFooter       String   @default("Terima kasih!")
  printerDriver       String   @default("SIMULATOR")
  printerDevicePath   String   @default("/dev/usb/lp0")
  printerHost         String   @default("")
  printerPort         Int      @default(9100)
```

3. Ganti `model Bill` (hapus komentar "M1 hanya membuat Bill OPEN…") dengan:
```prisma
model Bill {
  id                String        @id @default(cuid())
  number            String        @unique
  label             String        @default("")
  status            BillStatus    @default(OPEN)
  createdById       String
  shiftId           String?
  shift             Shift?        @relation("BillShift", fields: [shiftId], references: [id])
  billDiscountType  DiscountType?
  billDiscountValue Int           @default(0)
  subtotal          Int           @default(0)
  discountTotal     Int           @default(0)
  serviceTotal      Int           @default(0)
  taxTotal          Int           @default(0)
  grandTotal        Int           @default(0)
  paidAt            DateTime?
  paidById          String?
  /// Idempotency key checkout; unik → satu checkout per bill.
  checkoutKey       String?       @unique
  mergedIntoId      String?
  cancelReason      String?
  voidReason        String?
  voidedById        String?
  voidedAt          DateTime?
  voidShiftId       String?
  voidShift         Shift?        @relation("BillVoidShift", fields: [voidShiftId], references: [id])
  createdAt         DateTime      @default(now())
  updatedAt         DateTime      @updatedAt
  sessions          Session[]
  lines             BillLine[]
  payments          Payment[]
  stockMovements    StockMovement[]

  @@index([status])
  @@index([createdAt])
}

model BillLine {
  id            String        @id @default(cuid())
  billId        String
  bill          Bill          @relation(fields: [billId], references: [id])
  type          LineType
  productId     String?
  product       Product?      @relation(fields: [productId], references: [id], onDelete: Restrict)
  /// Baris TIME: satu per sesi.
  sessionId     String?       @unique
  nameSnapshot  String
  unitPrice     Int
  qty           Int
  discountType  DiscountType?
  discountValue Int           @default(0)
  breakdown     Json?
  createdById   String
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  @@index([billId])
}

model Category {
  id        String    @id @default(cuid())
  name      String    @unique
  color     String    @default("#7C3AED")
  sortOrder Int       @default(0)
  active    Boolean   @default(true)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  products  Product[]
}

model Product {
  id         String          @id @default(cuid())
  name       String          @unique
  categoryId String
  category   Category        @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  kind       ProductKind
  price      Int
  stockQty   Int             @default(0)
  active     Boolean         @default(true)
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt
  lines      BillLine[]
  movements  StockMovement[]
}

model Payment {
  id        String        @id @default(cuid())
  billId    String
  bill      Bill          @relation(fields: [billId], references: [id])
  shiftId   String
  shift     Shift         @relation(fields: [shiftId], references: [id])
  method    PaymentMethod
  /// Bagian tagihan yang ditutup metode ini.
  amount    Int
  received  Int?
  change    Int?
  reference String?
  createdAt DateTime      @default(now())

  @@index([shiftId])
  @@index([billId])
}

model Shift {
  id          String    @id @default(cuid())
  openedById  String
  openedAt    DateTime
  openingCash Int
  closedById  String?
  closedAt    DateTime?
  countedCash Int?
  expectedCash Int?
  note        String?
  /// true selama terbuka, null setelah ditutup; unik → hanya satu shift terbuka.
  openFlag    Boolean?  @unique @default(true)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  payments    Payment[]
  bills       Bill[]    @relation("BillShift")
  voidedBills Bill[]    @relation("BillVoidShift")
}

model StockMovement {
  id        String      @id @default(cuid())
  productId String
  product   Product     @relation(fields: [productId], references: [id])
  qty       Int
  reason    StockReason
  billId    String
  bill      Bill        @relation(fields: [billId], references: [id])
  userId    String
  createdAt DateTime    @default(now())

  @@unique([billId, productId, reason])
}

model PrintJob {
  id            String      @id @default(cuid())
  kind          PrintKind
  billId        String?
  shiftId       String?
  status        PrintStatus @default(PENDING)
  error         String?
  previewText   String
  requestedById String
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  @@index([createdAt])
}
```

- [ ] **Step 5: Buat migrasi tanpa menyentuh database**

```bash
cd apps/server
OLD=$(mktemp --suffix=.prisma)
git show HEAD:apps/server/prisma/schema.prisma > "$OLD"
mkdir -p prisma/migrations/20261001090000_m2_transaksi
pnpm exec prisma migrate diff --from-schema-datamodel "$OLD" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261001090000_m2_transaksi/migration.sql
rm "$OLD"
pnpm exec prisma generate
```
Expected: `migration.sql` berisi `ALTER TYPE "BillStatus" ADD VALUE 'CANCELLED'`, `CREATE TABLE "BillLine"` … dan `CREATE UNIQUE INDEX "Shift_openFlag_key"`. (Test global-setup menerapkannya ke `funplay_test` dengan `migrate deploy`.)

- [ ] **Step 6: Ekspos pengaturan baru**

`apps/server/src/modules/settings/settings.service.ts` — `toPublicSettings` menambah:
```ts
    taxPct: s.taxPct,
    taxScope: s.taxScope,
    servicePct: s.servicePct,
    serviceScope: s.serviceScope,
    discountApprovalPct: s.discountApprovalPct,
    receiptHeader: s.receiptHeader,
    receiptFooter: s.receiptFooter,
    printerDriver: s.printerDriver as PrinterDriver,
    printerDevicePath: s.printerDevicePath,
    printerHost: s.printerHost,
    printerPort: s.printerPort,
```
dan `settingsUpdateSchema` menambah field (import `SCOPES`, `PRINTER_DRIVERS`, `type PrinterDriver` dari `@funplay/shared`):
```ts
    taxPct: z.number().int().min(0).max(100),
    taxScope: z.enum(SCOPES),
    servicePct: z.number().int().min(0).max(100),
    serviceScope: z.enum(SCOPES),
    discountApprovalPct: z.number().int().min(0).max(100),
    receiptHeader: z.string().max(200),
    receiptFooter: z.string().max(200),
    printerDriver: z.enum(PRINTER_DRIVERS),
    printerDevicePath: z.string().trim().max(200),
    printerHost: z.string().trim().max(100),
    printerPort: z.number().int().min(1).max(65535),
```

- [ ] **Step 7: Jalankan test & typecheck semua paket**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (server memakai skema baru; fixture web sudah lengkap).

- [ ] **Step 8: Commit**

```bash
git add apps/server/prisma apps/server/src/modules/settings apps/server/test/settings-users.test.ts packages/shared apps/web/src
git commit -m "feat(server): M2 schema and transaction settings"
```

---

### Task 5: Shift — buka, tutup, rekap; shift wajib untuk mulai sesi

**Files:**
- Create: `apps/server/src/modules/shifts/shifts.service.ts`, `apps/server/src/modules/shifts/shifts.routes.ts`
- Modify: `apps/server/src/context.ts`, `apps/server/src/app.ts`, `apps/server/src/lib/bus.ts`, `apps/server/src/modules/realtime/realtime.ts`, `apps/server/src/modules/sessions/sessions.service.ts`
- Modify: `apps/server/test/helpers.ts` dan setiap test M1 yang memanggil `POST /api/sessions` (`grep -l "url: '/api/sessions'" apps/server/test/*.test.ts`)
- Test: `apps/server/test/shifts.test.ts`

**Interfaces:**
- Consumes: `ShiftView`, `ShiftSummary`, `PAYMENT_METHODS` (Task 1); model `Shift`, `Payment`, `Bill.voidShiftId` (Task 4); `audit`, `conflict`.
- Produces:
  - `currentShift(db): Promise<Shift | null>`, `requireOpenShift(db): Promise<Shift>` (409 `NO_OPEN_SHIFT`), `toShiftView(db, s)`, `shiftSummary(db, s): Promise<ShiftSummary>`, `userNames(db, ids): Promise<Map<string, string>>`.
  - `ShiftService` di `ctx.shifts`: `open(user, openingCash)`, `close(user, { countedCash, note })` → `Shift` yang ditutup.
  - Bus: `'shift.changed': []`, `'bill.changed': [billId: string]`, `'print.job': [PrintJobView]` (dua terakhir dipakai Task 7–9). Realtime mengirim `shift`, `bill` (`{ id }`), `printJob`.
  - Route: `GET /api/shifts/current` → `{ summary: ShiftSummary | null }`; `POST /api/shifts` `{ openingCash }` → `{ summary }`; `POST /api/shifts/current/close` `{ countedCash, note? }` → `{ summary }`; `GET /api/shifts` → `ShiftView[]` (terbaru dulu, 30); `GET /api/shifts/:id` → `ShiftSummary`.
  - Helper test: `openShift(userId: string, openingCash = 0): Promise<Shift>`.
  - `SessionService.start` menolak tanpa shift (409 `NO_OPEN_SHIFT`) dan mengisi `Bill.label = unit.name`.

Kas seharusnya = `openingCash + Σ Payment.amount CASH di shift ini − Σ Payment.amount CASH dari bill yang di-void di shift ini` (`amount` sudah tanpa kembalian).

- [ ] **Step 1: Helper test**

Tambahkan ke `apps/server/test/helpers.ts`:
```ts
export async function openShift(userId: string, openingCash = 0) {
  return prisma.shift.create({ data: { openedById: userId, openedAt: T0, openingCash, openFlag: true } });
}
```
Di setiap file test M1 yang memulai sesi lewat `POST /api/sessions`, ubah `await seedUsers();` di `beforeEach` menjadi:
```ts
  const u = await seedUsers();
  await openShift(u.kasir.id);
```
(bila file sudah menyimpan hasil `seedUsers()` ke variabel, pakai variabel itu).

- [ ] **Step 2: Tulis test yang gagal**

`apps/server/test/shifts.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;

beforeEach(async () => {
  await resetDb();
  await seedUsers();
  b = await seedBasics();
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST', url: string, payload?: unknown) => t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
const openShift = (openingCash = 200000) => req('POST', '/api/shifts', { openingCash });

describe('buka & tutup shift', () => {
  it('buka shift → current berisi ringkasan dengan kas seharusnya = kas awal', async () => {
    expect((await req('GET', '/api/shifts/current')).json()).toEqual({ summary: null });
    const res = await openShift();
    expect(res.statusCode).toBe(200);
    const summary = res.json().summary;
    expect(summary.shift).toMatchObject({ openingCash: 200000, openedByName: 'kasir', closedAt: null });
    expect(summary).toMatchObject({ expectedCash: 200000, billCount: 0, sales: { CASH: 0, QRIS: 0, CARD: 0, TRANSFER: 0 } });
    expect((await req('GET', '/api/shifts/current')).json().summary.shift.id).toBe(summary.shift.id);
  });

  it('shift kedua ditolak, termasuk saat dibuka bersamaan', async () => {
    const [a, c] = await Promise.all([openShift(), openShift()]);
    expect([a.statusCode, c.statusCode].sort()).toEqual([200, 409]);
    expect([a, c].find((r) => r.statusCode === 409)!.json().error.code).toBe('SHIFT_ALREADY_OPEN');
    expect(await prisma.shift.count()).toBe(1);
  });

  it('tutup shift menyimpan kas dihitung & seharusnya; tutup lagi → NO_OPEN_SHIFT', async () => {
    await openShift(150000);
    const res = await req('POST', '/api/shifts/current/close', { countedCash: 145000, note: 'kurang receh' });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.shift).toMatchObject({ countedCash: 145000, expectedCash: 150000, note: 'kurang receh', closedByName: 'kasir' });
    expect((await req('GET', '/api/shifts/current')).json()).toEqual({ summary: null });
    const again = await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('NO_OPEN_SHIFT');
    const list = (await req('GET', '/api/shifts')).json();
    expect(list).toHaveLength(1);
    expect(list[0].closedAt).not.toBeNull();
  });

  it('kas awal negatif ditolak', async () => {
    expect((await openShift(-1)).statusCode).toBe(400);
  });
});

describe('shift dan sesi', () => {
  it('mulai sesi tanpa shift → 409 NO_OPEN_SHIFT', async () => {
    const res = await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_OPEN_SHIFT');
  });

  it('dengan shift: sesi mulai dan bill diberi label nama meja', async () => {
    await openShift();
    const res = await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' });
    expect(res.statusCode).toBe(200);
    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: res.json().unit.session.billId } });
    expect(bill.label).toBe('Meja 1');
  });

  it('meja yang sedang jalan tetap bisa di-stop setelah shift ditutup', async () => {
    await openShift();
    const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    await req('POST', '/api/shifts/current/close', { countedCash: 200000 });
    t.clock.advanceMinutes(30);
    expect((await req('POST', `/api/sessions/${s.id}/stop`, {})).statusCode).toBe(200);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- shifts`
Expected: FAIL — `/api/shifts` 404.

- [ ] **Step 4: Implementasi service**

`apps/server/src/modules/shifts/shifts.service.ts`:
```ts
import { Prisma, type Shift } from '@prisma/client';
import { PAYMENT_METHODS, type PaymentMethod, type PublicUser, type ShiftSummary, type ShiftView } from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { conflict } from '../../lib/errors';
import { audit } from '../audit/audit';

export const currentShift = (db: Db) => db.shift.findFirst({ where: { openFlag: true } });

export async function requireOpenShift(db: Db): Promise<Shift> {
  const s = await currentShift(db);
  if (!s) throw conflict('NO_OPEN_SHIFT', 'Belum ada shift terbuka. Buka shift terlebih dahulu.');
  return s;
}

export async function userNames(db: Db, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (!wanted.length) return new Map();
  const rows = await db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function toShiftView(db: Db, s: Shift): Promise<ShiftView> {
  const names = await userNames(db, [s.openedById, s.closedById]);
  return {
    id: s.id,
    openedAt: s.openedAt.toISOString(),
    openedByName: names.get(s.openedById) ?? '-',
    openingCash: s.openingCash,
    closedAt: s.closedAt?.toISOString() ?? null,
    closedByName: s.closedById ? (names.get(s.closedById) ?? '-') : null,
    countedCash: s.countedCash,
    expectedCash: s.expectedCash,
    note: s.note,
  };
}

const zero = () => Object.fromEntries(PAYMENT_METHODS.map((m) => [m, 0])) as Record<PaymentMethod, number>;

export async function shiftSummary(db: Db, s: Shift): Promise<ShiftSummary> {
  const sales = zero();
  const voids = zero();
  for (const g of await db.payment.groupBy({ by: ['method'], where: { shiftId: s.id }, _sum: { amount: true } })) {
    sales[g.method] = g._sum.amount ?? 0;
  }
  for (const g of await db.payment.groupBy({ by: ['method'], where: { bill: { voidShiftId: s.id } }, _sum: { amount: true } })) {
    voids[g.method] = g._sum.amount ?? 0;
  }
  const [billCount, voidCount] = await Promise.all([
    db.bill.count({ where: { shiftId: s.id, status: { in: ['PAID', 'VOID'] } } }),
    db.bill.count({ where: { voidShiftId: s.id } }),
  ]);
  return { shift: await toShiftView(db, s), sales, voids, billCount, voidCount, expectedCash: s.openingCash + sales.CASH - voids.CASH };
}

export class ShiftService {
  constructor(private readonly ctx: AppContext) {}

  async open(user: PublicUser, openingCash: number): Promise<Shift> {
    const { prisma, clock } = this.ctx;
    let shift: Shift;
    try {
      shift = await prisma.shift.create({ data: { openedById: user.id, openedAt: clock.now(), openingCash, openFlag: true } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('SHIFT_ALREADY_OPEN', 'Masih ada shift terbuka. Tutup shift tersebut terlebih dahulu.');
      }
      throw err;
    }
    await audit(prisma, { userId: user.id, action: 'shift.open', entity: 'Shift', entityId: shift.id, data: { openingCash } });
    this.ctx.bus.emit('shift.changed');
    return shift;
  }

  async close(user: PublicUser, input: { countedCash: number; note?: string }): Promise<Shift> {
    const { prisma, clock } = this.ctx;
    const closed = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Shift" WHERE "openFlag" = true FOR UPDATE`;
      const s = await requireOpenShift(tx);
      const summary = await shiftSummary(tx, s);
      const updated = await tx.shift.update({
        where: { id: s.id },
        data: {
          closedById: user.id,
          closedAt: clock.now(),
          countedCash: input.countedCash,
          expectedCash: summary.expectedCash,
          note: input.note?.trim() || null,
          openFlag: null,
        },
      });
      await audit(tx, {
        userId: user.id, action: 'shift.close', entity: 'Shift', entityId: s.id,
        data: { expectedCash: summary.expectedCash, countedCash: input.countedCash, difference: input.countedCash - summary.expectedCash },
      });
      return updated;
    });
    this.ctx.bus.emit('shift.changed');
    return closed;
  }
}
```

- [ ] **Step 5: Route, context, bus, realtime**

`apps/server/src/modules/shifts/shifts.routes.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { notFound } from '../../lib/errors';
import { requireAuth } from '../auth/guard';
import { currentShift, shiftSummary, toShiftView } from './shifts.service';

const openSchema = z.object({ openingCash: z.number().int().min(0) });
const closeSchema = z.object({ countedCash: z.number().int().min(0), note: z.string().max(200).optional() });
const idParam = z.object({ id: z.string().min(1) });

export function shiftsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.get('/shifts/current', auth, async () => {
      const s = await currentShift(ctx.prisma);
      return { summary: s ? await shiftSummary(ctx.prisma, s) : null };
    });

    app.post('/shifts', auth, async (req) => {
      const s = await ctx.shifts.open(req.user!, openSchema.parse(req.body).openingCash);
      return { summary: await shiftSummary(ctx.prisma, s) };
    });

    app.post('/shifts/current/close', auth, async (req) => {
      const s = await ctx.shifts.close(req.user!, closeSchema.parse(req.body));
      return { summary: await shiftSummary(ctx.prisma, s) };
    });

    app.get('/shifts', auth, async () => {
      const rows = await ctx.prisma.shift.findMany({ orderBy: { openedAt: 'desc' }, take: 30 });
      return Promise.all(rows.map((s) => toShiftView(ctx.prisma, s)));
    });

    app.get('/shifts/:id', auth, async (req) => {
      const s = await ctx.prisma.shift.findUnique({ where: { id: idParam.parse(req.params).id } });
      if (!s) throw notFound('Shift');
      return shiftSummary(ctx.prisma, s);
    });
  };
}
```

`apps/server/src/context.ts`: tambah `shifts: ShiftService;` (import type dari `./modules/shifts/shifts.service`).

`apps/server/src/app.ts`: setelah `ctx.sessions = new SessionService(ctx);` tambah `ctx.shifts = new ShiftService(ctx);`; di blok `/api` tambah `await api.register(shiftsRoutes(ctx));`.

`apps/server/src/lib/bus.ts` — `BusEvents` ditambah (import `PrintJobView` dari `@funplay/shared`):
```ts
  'bill.changed': [billId: string];
  'shift.changed': [];
  'print.job': [PrintJobView];
```

`apps/server/src/modules/realtime/realtime.ts` — setelah forwarder `device.changed`:
```ts
  ctx.bus.on('bill.changed', (id) => room().emit('bill', { id }));
  ctx.bus.on('shift.changed', () => room().emit('shift'));
  ctx.bus.on('print.job', (job) => room().emit('printJob', job));
```

- [ ] **Step 6: Shift wajib saat mulai sesi**

Di `SessionService.start` (`sessions.service.ts`), import `requireOpenShift` dari `../shifts/shifts.service`; di dalam `prisma.$transaction`, baris pertama callback: `await requireOpenShift(tx);`. Pembuatan bill menjadi:
```ts
        const bill = await tx.bill.create({
          data: { number: await nextBillNumber(tx, now, settings.utcOffsetMin), label: unit.name, createdById: user.id },
        });
```

- [ ] **Step 7: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS (shifts.test baru + semua test M1 yang kini membuka shift di `beforeEach`).

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(server): single open shift with cash summary; sessions require an open shift"
```

---

### Task 6: Katalog — kategori & produk/layanan

**Files:**
- Create: `apps/server/src/modules/catalog/categories.routes.ts`, `apps/server/src/modules/catalog/products.routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/test/products.test.ts`

**Interfaces:**
- Consumes: `CategoryDto`, `ProductDto`, `PRODUCT_KINDS` (Task 1); model `Category`, `Product` (Task 4); `requireRole`, `audit`.
- Produces: `GET /api/categories` → `CategoryDto[]` (urut `sortOrder`, nama); `POST/PATCH/DELETE /api/categories[/:id]`; `GET /api/products` → `ProductDto[]` (urut nama); `POST/PATCH/DELETE /api/products[/:id]`. GET untuk semua user login; tulis hanya SUPERVISOR & OWNER. Hapus yang masih dipakai → 409 `IN_USE`; nama ganda → 409 `DUPLICATE` (error handler M1).

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/products.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, prisma, resetDb, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let users: Awaited<ReturnType<typeof seedUsers>>;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  t = await makeApp();
});
afterEach(() => t.app.close());

const as = async (username: string) => {
  const cookie = await loginAs(t.app, username);
  return (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    t.app.inject({ method, url, headers: { cookie }, payload: payload as object });
};

describe('katalog', () => {
  it('supervisor membuat kategori & produk; semua user bisa membaca', async () => {
    const sup = await as('supervisor');
    const cat = (await sup('POST', '/api/categories', { name: 'Minuman', color: '#06B6D4' })).json();
    expect(cat).toMatchObject({ name: 'Minuman', color: '#06B6D4', sortOrder: 0, active: true });
    const p = await sup('POST', '/api/products', { name: 'Es Teh Manis', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 50 });
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ name: 'Es Teh Manis', kind: 'STOCK', price: 8000, stockQty: 50, active: true });

    const kasir = await as('kasir');
    expect((await kasir('GET', '/api/products')).json()).toHaveLength(1);
    expect((await kasir('GET', '/api/categories')).json()).toHaveLength(1);
  });

  it('kasir tidak boleh menulis katalog', async () => {
    const kasir = await as('kasir');
    expect((await kasir('POST', '/api/categories', { name: 'X' })).statusCode).toBe(403);
  });

  it('validasi: harga negatif, jenis tak dikenal, nama ganda', async () => {
    const own = await as('owner');
    const cat = (await own('POST', '/api/categories', { name: 'Makanan' })).json();
    expect((await own('POST', '/api/products', { name: 'A', categoryId: cat.id, kind: 'STOCK', price: -1 })).statusCode).toBe(400);
    expect((await own('POST', '/api/products', { name: 'A', categoryId: cat.id, kind: 'BARANG', price: 1 })).statusCode).toBe(400);
    await own('POST', '/api/products', { name: 'Mie Goreng', categoryId: cat.id, kind: 'STOCK', price: 15000 });
    const dup = await own('POST', '/api/products', { name: 'Mie Goreng', categoryId: cat.id, kind: 'STOCK', price: 15000 });
    expect(dup.statusCode).toBe(409);
  });

  it('ubah harga; hapus produk yang belum dipakai; yang sudah dipakai → IN_USE', async () => {
    const own = await as('owner');
    const cat = (await own('POST', '/api/categories', { name: 'Layanan' })).json();
    const a = (await own('POST', '/api/products', { name: 'Sewa Stick', categoryId: cat.id, kind: 'SERVICE', price: 10000 })).json();
    const b = (await own('POST', '/api/products', { name: 'Loker', categoryId: cat.id, kind: 'SERVICE', price: 5000 })).json();
    expect((await own('PATCH', `/api/products/${a.id}`, { price: 12000 })).json().price).toBe(12000);
    expect((await own('DELETE', `/api/products/${b.id}`)).statusCode).toBe(204);

    const bill = await prisma.bill.create({ data: { number: 'FP-20261001-0001', createdById: users.owner.id } });
    await prisma.billLine.create({ data: { billId: bill.id, type: 'SERVICE', productId: a.id, nameSnapshot: 'Sewa Stick', unitPrice: 12000, qty: 1, createdById: users.owner.id } });
    const used = await own('DELETE', `/api/products/${a.id}`);
    expect(used.statusCode).toBe(409);
    expect(used.json().error.code).toBe('IN_USE');
    expect((await own('DELETE', `/api/categories/${cat.id}`)).json().error.code).toBe('IN_USE');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- products`
Expected: FAIL — 404.

- [ ] **Step 3: Implementasi**

`apps/server/src/modules/catalog/categories.routes.ts`:
```ts
import type { Category } from '@prisma/client';
import type { CategoryDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const fields = {
  name: z.string().trim().min(1).max(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Warna harus format #RRGGBB'),
  sortOrder: z.number().int().min(0).max(9999),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, color: fields.color.default('#7C3AED'), sortOrder: fields.sortOrder.default(0), active: fields.active.default(true) });
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

const toDto = (c: Category): CategoryDto => ({ id: c.id, name: c.name, color: c.color, sortOrder: c.sortOrder, active: c.active });

export function categoriesRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const editor = { preHandler: requireRole('SUPERVISOR', 'OWNER') };

    app.get('/categories', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.category.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })).map(toDto),
    );

    app.post('/categories', editor, async (req) => {
      const c = await ctx.prisma.category.create({ data: createSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'category.create', entity: 'Category', entityId: c.id });
      return toDto(c);
    });

    app.patch('/categories/:id', editor, async (req) => {
      const { id } = idParam.parse(req.params);
      const c = await ctx.prisma.category.update({ where: { id }, data: patchSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'category.update', entity: 'Category', entityId: id });
      return toDto(c);
    });

    app.delete('/categories/:id', editor, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.category.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'category.delete', entity: 'Category', entityId: id });
      return reply.status(204).send();
    });
  };
}
```

`apps/server/src/modules/catalog/products.routes.ts`:
```ts
import type { Product } from '@prisma/client';
import { PRODUCT_KINDS, type ProductDto } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const fields = {
  name: z.string().trim().min(1).max(60),
  categoryId: z.string().min(1),
  kind: z.enum(PRODUCT_KINDS),
  price: z.number().int().min(0),
  stockQty: z.number().int().min(-99999).max(99999),
  active: z.boolean(),
};
const createSchema = z.object({ ...fields, stockQty: fields.stockQty.default(0), active: fields.active.default(true) });
const patchSchema = z.object(fields).partial();
const idParam = z.object({ id: z.string().min(1) });

const toDto = (p: Product): ProductDto => ({ id: p.id, name: p.name, categoryId: p.categoryId, kind: p.kind, price: p.price, stockQty: p.stockQty, active: p.active });

export function productsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const editor = { preHandler: requireRole('SUPERVISOR', 'OWNER') };

    app.get('/products', { preHandler: requireAuth }, async () =>
      (await ctx.prisma.product.findMany({ orderBy: { name: 'asc' } })).map(toDto),
    );

    app.post('/products', editor, async (req) => {
      const p = await ctx.prisma.product.create({ data: createSchema.parse(req.body) });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'product.create', entity: 'Product', entityId: p.id });
      return toDto(p);
    });

    app.patch('/products/:id', editor, async (req) => {
      const { id } = idParam.parse(req.params);
      const data = patchSchema.parse(req.body);
      const p = await ctx.prisma.product.update({ where: { id }, data });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'product.update', entity: 'Product', entityId: id, data });
      return toDto(p);
    });

    app.delete('/products/:id', editor, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      await ctx.prisma.product.delete({ where: { id } });
      await audit(ctx.prisma, { userId: req.user!.id, action: 'product.delete', entity: 'Product', entityId: id });
      return reply.status(204).send();
    });
  };
}
```

`app.ts`: daftarkan `categoriesRoutes(ctx)` dan `productsRoutes(ctx)` di blok `/api`.

- [ ] **Step 4: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/server test -- products && pnpm --filter @funplay/server typecheck`
Expected: PASS. (Bila "hapus dipakai → IN_USE" gagal dengan 500, pastikan relasi `BillLine.product` dan `Product.category` ber-`onDelete: Restrict` seperti Task 4 — error handler M1 menangani SQLSTATE 23001/23503.)

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): categories and products catalog"
```

---

### Task 7: Bill & pesanan — baris waktu saat stop, tagihan lepas, item, diskon, batal, gabung

**Files:**
- Create: `apps/server/src/modules/billing/bill-view.ts`, `apps/server/src/modules/billing/bills.service.ts`, `apps/server/src/modules/billing/bills.routes.ts`
- Modify: `apps/server/src/context.ts`, `apps/server/src/app.ts`, `apps/server/src/modules/sessions/sessions.service.ts`
- Test: `apps/server/test/bills.test.ts`

**Interfaces:**
- Consumes: `computeBillTotals`, `lineScope`, `BillView`, `BillSummary`, `Discount`, `DISCOUNT_TYPES`, `BILL_STATUSES` (Task 1); `requireOpenShift`, `userNames` (Task 5); `toSessionView`, `sessionParts`, `approveWithPin`, `nextBillNumber`, `getSettings` (M1).
- Produces:
  - `bill-view.ts`: `billInclude`, `type BillRow`, `lineDiscount(line)`, `billDiscountOf(bill)`, `totalsInput(lines)`, `linesTotals(bill, settings, discount?)`, `toBillView(db, row)`, `loadBillView(db, id)`, `lockBill(tx, id)`, `discountSchema` (zod).
  - `BillService` di `ctx.bills`: `createStandalone(user)`, `addItems(user, billId, items)`, `updateLine(user, billId, lineId, input)`, `deleteLine(user, billId, lineId, approvalPin?)`, `setBillDiscount(user, billId, discount)`, `cancel(user, billId, input)`, `merge(user, targetId, sourceId)`, `list(filter)` → `BillSummary[]`. Semua mutasi mengembalikan `BillView` dan memancarkan `bill.changed`.
  - Route: `GET /api/bills?status=&from=&to=&q=`, `GET /api/bills/:id`, `POST /api/bills`, `POST /api/bills/:id/items`, `PATCH /api/bills/:id/items/:lineId`, `DELETE /api/bills/:id/items/:lineId` (body `{ approvalPin? }`), `PUT /api/bills/:id/discount`, `POST /api/bills/:id/cancel`, `POST /api/bills/:id/merge`.
  - `SessionService.stop` membuat satu `BillLine` TIME: nama `"<meja> - Open billing"` atau `"<meja> - <nama paket>"`, `unitPrice = charge.total`, `qty = 1`, `breakdown = charge.lines`, `sessionId` sesi itu; lalu emit `bill.changed`.

Kode error baru: `BILL_NOT_OPEN` (409), `LINE_LOCKED` (409), `PRODUCT_INACTIVE` (400), `SESSION_ACTIVE` (409), `SAME_BILL` (400), `REASON_REQUIRED` (zod 400).

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/bills.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;
let teh: { id: string };
let stick: { id: string };

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id);
  const cat = await prisma.category.create({ data: { name: 'Minuman' } });
  teh = await prisma.product.create({ data: { name: 'Es Teh', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 10 } });
  stick = await prisma.product.create({ data: { name: 'Sewa Stick', categoryId: cat.id, kind: 'SERVICE', price: 10000 } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });

async function playAndStop(unitId = b.m1.id, minutes = 60) {
  const s = (await req('POST', '/api/sessions', { unitId, mode: 'OPEN' })).json().unit.session;
  t.clock.advanceMinutes(minutes);
  await req('POST', `/api/sessions/${s.id}/stop`, {});
  t.clock.set(new Date('2026-10-01T03:00:00Z'));
  return s.billId as string;
}

describe('stop membuat baris waktu', () => {
  it('bill tetap OPEN dengan satu baris TIME berisi rincian tarif; meja kosong', async () => {
    const billId = await playAndStop();
    const bill = (await req('GET', `/api/bills/${billId}`)).json();
    expect(bill).toMatchObject({ status: 'OPEN', label: 'Meja 1', activeSessions: [], stored: null });
    expect(bill.lines).toEqual([
      expect.objectContaining({ type: 'TIME', name: 'Meja 1 - Open billing', unitPrice: 40000, qty: 1, discount: null }),
    ]);
    expect(bill.lines[0].breakdown[0]).toMatchObject({ label: 'Reguler Siang', minutes: 60, amount: 40000 });
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: b.m1.id }, include: { activeSession: true } });
    expect(unit.activeSession).toBeNull();
  });

  it('bill sesi berjalan menampilkan activeSessions', async () => {
    const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    const bill = (await req('GET', `/api/bills/${s.billId}`)).json();
    expect(bill.activeSessions).toHaveLength(1);
    expect(bill.activeSessions[0]).toMatchObject({ id: s.id, unitName: 'Meja 1', status: 'RUNNING' });
  });
});

describe('tagihan lepas & item', () => {
  it('tagihan lepas butuh shift', async () => {
    await prisma.shift.updateMany({ data: { openFlag: null, closedAt: new Date() } });
    const res = await req('POST', '/api/bills');
    expect(res.json().error.code).toBe('NO_OPEN_SHIFT');
  });

  it('tambah produk, produk sama digabung qty, item manual diaudit', async () => {
    const bill = (await req('POST', '/api/bills')).json();
    expect(bill).toMatchObject({ label: 'Tagihan lepas', status: 'OPEN', lines: [] });
    await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] });
    const after = (
      await req('POST', `/api/bills/${bill.id}/items`, {
        items: [{ productId: teh.id, qty: 2 }, { productId: stick.id, qty: 1 }, { custom: { name: 'Charger HP', price: 5000 }, qty: 1 }],
      })
    ).json();
    expect(after.lines.map((l: { type: string; name: string; qty: number; unitPrice: number }) => [l.type, l.name, l.qty, l.unitPrice])).toEqual([
      ['PRODUCT', 'Es Teh', 3, 8000],
      ['SERVICE', 'Sewa Stick', 1, 10000],
      ['CUSTOM', 'Charger HP', 1, 5000],
    ]);
    expect(await prisma.auditLog.count({ where: { action: 'bill.custom_item' } })).toBe(1);
  });

  it('produk nonaktif ditolak; bill yang sudah bukan OPEN tidak bisa diubah', async () => {
    const bill = (await req('POST', '/api/bills')).json();
    await prisma.product.update({ where: { id: teh.id }, data: { active: false } });
    expect((await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] })).json().error.code).toBe('PRODUCT_INACTIVE');
    await prisma.bill.update({ where: { id: bill.id }, data: { status: 'PAID' } });
    expect((await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: stick.id, qty: 1 }] })).json().error.code).toBe('BILL_NOT_OPEN');
  });

  it('kasir: tambah qty bebas, kurangi qty & hapus butuh PIN', async () => {
    const bill = (await req('POST', '/api/bills')).json();
    const line = (await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 2 }] })).json().lines[0];
    expect((await req('PATCH', `/api/bills/${bill.id}/items/${line.id}`, { qty: 3 })).statusCode).toBe(200);
    expect((await req('PATCH', `/api/bills/${bill.id}/items/${line.id}`, { qty: 1 })).json().error.code).toBe('APPROVAL_REQUIRED');
    expect((await req('PATCH', `/api/bills/${bill.id}/items/${line.id}`, { qty: 1, approvalPin: '1111' })).json().lines[0].qty).toBe(1);
    expect((await req('DELETE', `/api/bills/${bill.id}/items/${line.id}`, {})).json().error.code).toBe('APPROVAL_REQUIRED');
    const del = await req('DELETE', `/api/bills/${bill.id}/items/${line.id}`, { approvalPin: '1111' });
    expect(del.json().lines).toEqual([]);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'bill.remove_item' } });
    expect(log.approvedById).toBe(users.supervisor.id);
  });

  it('diskon item & bill tersimpan; baris TIME tidak bisa dihapus atau diubah qty', async () => {
    const billId = await playAndStop();
    const time = (await req('GET', `/api/bills/${billId}`)).json().lines[0];
    expect((await req('DELETE', `/api/bills/${billId}/items/${time.id}`, { approvalPin: '1111' })).json().error.code).toBe('LINE_LOCKED');
    expect((await req('PATCH', `/api/bills/${billId}/items/${time.id}`, { qty: 2 })).json().error.code).toBe('LINE_LOCKED');
    const d = await req('PATCH', `/api/bills/${billId}/items/${time.id}`, { discount: { type: 'PERCENT', value: 10 } });
    expect(d.json().lines[0].discount).toEqual({ type: 'PERCENT', value: 10 });
    const bd = await req('PUT', `/api/bills/${billId}/discount`, { discount: { type: 'AMOUNT', value: 5000 } });
    expect(bd.json().billDiscount).toEqual({ type: 'AMOUNT', value: 5000 });
    expect((await req('PUT', `/api/bills/${billId}/discount`, { discount: { type: 'PERCENT', value: 120 } })).statusCode).toBe(400);
  });
});

describe('batal & gabung', () => {
  it('batal: sesi aktif ditolak; bertagihan butuh PIN; kosong tidak', async () => {
    const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
    expect((await req('POST', `/api/bills/${s.billId}/cancel`, { reason: 'salah meja' })).json().error.code).toBe('SESSION_ACTIVE');

    const billId = await playAndStop(b.m2.id);
    expect((await req('POST', `/api/bills/${billId}/cancel`, { reason: 'tes' })).json().error.code).toBe('APPROVAL_REQUIRED');
    const ok = await req('POST', `/api/bills/${billId}/cancel`, { reason: 'tes', approvalPin: '1111' });
    expect(ok.json()).toMatchObject({ status: 'CANCELLED', cancelReason: 'tes' });

    const empty = (await req('POST', '/api/bills')).json();
    expect((await req('POST', `/api/bills/${empty.id}/cancel`, { reason: 'tidak jadi' })).json().status).toBe('CANCELLED');
    expect((await req('POST', `/api/bills/${empty.id}/cancel`, { reason: '' })).statusCode).toBe(400);
  });

  it('gabung dua bill: baris & sesi pindah, sumber CANCELLED', async () => {
    const a = await playAndStop(b.m1.id);
    const running = (await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN' })).json().unit.session;
    const merged = await req('POST', `/api/bills/${a}/merge`, { sourceBillId: running.billId });
    expect(merged.statusCode).toBe(200);
    expect(merged.json()).toMatchObject({ label: 'Meja 1 + Meja 2' });
    expect(merged.json().activeSessions.map((x: { id: string }) => x.id)).toEqual([running.id]);
    const source = await prisma.bill.findUniqueOrThrow({ where: { id: running.billId } });
    expect(source).toMatchObject({ status: 'CANCELLED', mergedIntoId: a });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: running.id } })).billId).toBe(a);

    expect((await req('POST', `/api/bills/${a}/merge`, { sourceBillId: a })).json().error.code).toBe('SAME_BILL');
    expect((await req('POST', `/api/bills/${a}/merge`, { sourceBillId: running.billId })).json().error.code).toBe('BILL_NOT_OPEN');
  });

  it('daftar: filter status & cari nomor', async () => {
    const a = await playAndStop(b.m1.id);
    await req('POST', '/api/bills');
    const open = (await req('GET', '/api/bills?status=OPEN')).json();
    expect(open).toHaveLength(2);
    expect(open.find((x: { id: string }) => x.id === a)).toMatchObject({ total: 40000, hasActiveSession: false, label: 'Meja 1' });
    const found = (await req('GET', '/api/bills?q=0001')).json();
    expect(found.map((x: { id: string }) => x.id)).toEqual([a]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- bills`
Expected: FAIL — 404 / baris TIME tidak ada.

- [ ] **Step 3: `bill-view.ts`**

```ts
import type { Prisma, BillLine } from '@prisma/client';
import {
  computeBillTotals, DISCOUNT_TYPES, lineScope,
  type BillSummary, type BillTotals, type BillView, type ChargeLine, type Discount, type PublicSettings, type TotalsLineInput,
} from '@funplay/shared';
import { z } from 'zod';
import type { Db } from '../../db';
import { notFound } from '../../lib/errors';
import { toSessionView } from '../board/board';
import { sessionParts } from '../sessions/sessions.service';
import { userNames } from '../shifts/shifts.service';

export const discountSchema = z
  .object({ type: z.enum(DISCOUNT_TYPES), value: z.number().int().min(0) })
  .refine((d) => d.type !== 'PERCENT' || d.value <= 100, { message: 'Diskon persen maksimal 100' });

export const billInclude = {
  lines: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  sessions: { where: { status: { not: 'ENDED' } }, include: { ...sessionParts, unit: { select: { name: true } } } },
} satisfies Prisma.BillInclude;
export type BillRow = Prisma.BillGetPayload<{ include: typeof billInclude }>;

export const lineDiscount = (l: Pick<BillLine, 'discountType' | 'discountValue'>): Discount | null =>
  l.discountType ? { type: l.discountType, value: l.discountValue } : null;

export const billDiscountOf = (b: { billDiscountType: Discount['type'] | null; billDiscountValue: number }): Discount | null =>
  b.billDiscountType ? { type: b.billDiscountType, value: b.billDiscountValue } : null;

export const totalsInput = (lines: BillLine[]): TotalsLineInput[] =>
  lines.map((l) => ({ id: l.id, scope: lineScope(l.type), amount: l.unitPrice * l.qty, discount: lineDiscount(l) }));

/** Total dari baris tersimpan (sesi yang masih berjalan tidak ikut). */
export function linesTotals(
  bill: { lines: BillLine[]; billDiscountType: Discount['type'] | null; billDiscountValue: number },
  settings: PublicSettings,
  discount: Discount | null = billDiscountOf(bill),
): BillTotals {
  return computeBillTotals(totalsInput(bill.lines), discount, settings);
}

export async function lockBill(tx: Db, billId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Bill" WHERE id = ${billId} FOR UPDATE`;
  if (!rows.length) throw notFound('Bill');
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function toBillView(db: Db, b: BillRow): Promise<BillView> {
  const names = await userNames(db, [b.createdById, b.paidById]);
  return {
    id: b.id,
    number: b.number,
    label: b.label,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
    createdByName: names.get(b.createdById) ?? '-',
    billDiscount: billDiscountOf(b),
    lines: b.lines.map((l) => ({
      id: l.id,
      type: l.type,
      productId: l.productId,
      sessionId: l.sessionId,
      name: l.nameSnapshot,
      unitPrice: l.unitPrice,
      qty: l.qty,
      discount: lineDiscount(l),
      breakdown: (l.breakdown as ChargeLine[] | null) ?? null,
    })),
    activeSessions: b.sessions.map((s) => ({ ...toSessionView(s), unitName: s.unit.name })),
    payments: b.payments.map((p) => ({
      id: p.id, method: p.method, amount: p.amount, received: p.received, change: p.change, reference: p.reference, createdAt: p.createdAt.toISOString(),
    })),
    stored:
      b.status === 'PAID' || b.status === 'VOID'
        ? { subtotal: b.subtotal, discountTotal: b.discountTotal, serviceTotal: b.serviceTotal, taxTotal: b.taxTotal, grandTotal: b.grandTotal }
        : null,
    paidAt: iso(b.paidAt),
    paidByName: b.paidById ? (names.get(b.paidById) ?? '-') : null,
    shiftId: b.shiftId,
    mergedIntoId: b.mergedIntoId,
    cancelReason: b.cancelReason,
    voidReason: b.voidReason,
    voidedAt: iso(b.voidedAt),
  };
}

export async function loadBillView(db: Db, billId: string): Promise<BillView> {
  const b = await db.bill.findUnique({ where: { id: billId }, include: billInclude });
  if (!b) throw notFound('Bill');
  return toBillView(db, b);
}

export function toBillSummary(
  b: { id: string; number: string; label: string; status: BillSummary['status']; createdAt: Date; paidAt: Date | null; grandTotal: number;
       lines: BillLine[]; billDiscountType: Discount['type'] | null; billDiscountValue: number; sessions: { status: string }[] },
  settings: PublicSettings,
): BillSummary {
  const stored = b.status === 'PAID' || b.status === 'VOID';
  return {
    id: b.id,
    number: b.number,
    label: b.label,
    status: b.status,
    createdAt: b.createdAt.toISOString(),
    paidAt: iso(b.paidAt),
    total: stored ? b.grandTotal : linesTotals(b, settings).grandTotal,
    hasActiveSession: b.sessions.some((s) => s.status !== 'ENDED'),
  };
}
```

- [ ] **Step 4: `bills.service.ts`**

```ts
import type { BillLine } from '@prisma/client';
import type { BillStatus, BillSummary, BillView, Discount, PublicUser } from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { nextBillNumber } from '../sessions/sessions.service';
import { getSettings } from '../settings/settings.service';
import { requireOpenShift } from '../shifts/shifts.service';
import { linesTotals, loadBillView, lockBill, toBillSummary } from './bill-view';

export type AddItem = { productId: string; qty: number } | { custom: { name: string; price: number }; qty: number };
export interface BillFilter { status?: BillStatus; from?: Date; to?: Date; q?: string }

async function requireOpenBill(tx: Db, billId: string) {
  await lockBill(tx, billId);
  const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { lines: true } });
  if (bill.status !== 'OPEN') throw conflict('BILL_NOT_OPEN', 'Bill sudah tidak bisa diubah');
  return bill;
}

function findLine(lines: BillLine[], lineId: string): BillLine {
  const line = lines.find((l) => l.id === lineId);
  if (!line) throw notFound('Item');
  return line;
}

export class BillService {
  constructor(private readonly ctx: AppContext) {}

  private changed(...billIds: string[]): void {
    for (const id of billIds) this.ctx.bus.emit('bill.changed', id);
  }

  async createStandalone(user: PublicUser): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const settings = await getSettings(prisma);
    const bill = await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      const b = await tx.bill.create({ data: { number: await nextBillNumber(tx, clock.now(), settings.utcOffsetMin), label: 'Tagihan lepas', createdById: user.id } });
      await audit(tx, { userId: user.id, action: 'bill.create', entity: 'Bill', entityId: b.id });
      return b;
    });
    this.changed(bill.id);
    return loadBillView(prisma, bill.id);
  }

  async addItems(user: PublicUser, billId: string, items: AddItem[]): Promise<BillView> {
    const { prisma } = this.ctx;
    await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      const bill = await requireOpenBill(tx, billId);
      const lines = [...bill.lines];
      for (const item of items) {
        if ('custom' in item) {
          const l = await tx.billLine.create({
            data: { billId, type: 'CUSTOM', nameSnapshot: item.custom.name, unitPrice: item.custom.price, qty: item.qty, createdById: user.id },
          });
          await audit(tx, { userId: user.id, action: 'bill.custom_item', entity: 'Bill', entityId: billId, data: { lineId: l.id, name: item.custom.name, price: item.custom.price, qty: item.qty } });
          lines.push(l);
          continue;
        }
        const p = await tx.product.findUnique({ where: { id: item.productId } });
        if (!p) throw notFound('Produk');
        if (!p.active) throw badRequest('PRODUCT_INACTIVE', `${p.name} sedang tidak dijual`);
        const same = lines.find((l) => l.productId === p.id && l.unitPrice === p.price && !l.discountType);
        if (same) {
          const updated = await tx.billLine.update({ where: { id: same.id }, data: { qty: same.qty + item.qty } });
          lines[lines.indexOf(same)] = updated;
        } else {
          lines.push(
            await tx.billLine.create({
              data: { billId, type: p.kind === 'STOCK' ? 'PRODUCT' : 'SERVICE', productId: p.id, nameSnapshot: p.name, unitPrice: p.price, qty: item.qty, createdById: user.id },
            }),
          );
        }
      }
      await audit(tx, { userId: user.id, action: 'bill.add_items', entity: 'Bill', entityId: billId, data: { count: items.length } });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async updateLine(user: PublicUser, billId: string, lineId: string, input: { qty?: number; discount?: Discount | null; approvalPin?: string }): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const current = await prisma.billLine.findFirst({ where: { id: lineId, billId } });
    if (!current) throw notFound('Item');
    if (input.qty !== undefined && current.type === 'TIME' && input.qty !== current.qty) throw conflict('LINE_LOCKED', 'Jumlah baris waktu tidak bisa diubah');
    const decreasing = input.qty !== undefined && input.qty < current.qty;
    const approvedById = decreasing ? await approveWithPin(prisma, clock, user, input.approvalPin) : null;

    await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      const bill = await requireOpenBill(tx, billId);
      const line = findLine(bill.lines, lineId);
      if (input.qty !== undefined && input.qty < line.qty && !approvedById) throw conflict('TOTAL_CHANGED', 'Item berubah, muat ulang bill');
      await tx.billLine.update({
        where: { id: line.id },
        data: {
          ...(input.qty !== undefined ? { qty: input.qty } : {}),
          ...(input.discount !== undefined ? { discountType: input.discount?.type ?? null, discountValue: input.discount?.value ?? 0 } : {}),
        },
      });
      await audit(tx, { userId: user.id, action: 'bill.update_item', entity: 'Bill', entityId: billId, data: { lineId, from: line.qty, ...input, approvalPin: undefined }, approvedById });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async deleteLine(user: PublicUser, billId: string, lineId: string, approvalPin?: string): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const current = await prisma.billLine.findFirst({ where: { id: lineId, billId } });
    if (!current) throw notFound('Item');
    if (current.type === 'TIME') throw conflict('LINE_LOCKED', 'Baris waktu tidak bisa dihapus');
    const approvedById = await approveWithPin(prisma, clock, user, approvalPin);
    await prisma.$transaction(async (tx) => {
      const bill = await requireOpenBill(tx, billId);
      const line = findLine(bill.lines, lineId);
      await tx.billLine.delete({ where: { id: line.id } });
      await audit(tx, { userId: user.id, action: 'bill.remove_item', entity: 'Bill', entityId: billId, data: { name: line.nameSnapshot, qty: line.qty, unitPrice: line.unitPrice }, approvedById });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async setBillDiscount(user: PublicUser, billId: string, discount: Discount | null): Promise<BillView> {
    const { prisma } = this.ctx;
    await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      await requireOpenBill(tx, billId);
      await tx.bill.update({ where: { id: billId }, data: { billDiscountType: discount?.type ?? null, billDiscountValue: discount?.value ?? 0 } });
      await audit(tx, { userId: user.id, action: 'bill.discount', entity: 'Bill', entityId: billId, data: { discount } });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async cancel(user: PublicUser, billId: string, input: { reason: string; approvalPin?: string }): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const settings = await getSettings(prisma);
    const pre = await prisma.bill.findUnique({ where: { id: billId }, include: { lines: true, sessions: { where: { status: { not: 'ENDED' } } } } });
    if (!pre) throw notFound('Bill');
    if (pre.sessions.length) throw conflict('SESSION_ACTIVE', 'Hentikan sesi meja terlebih dahulu');
    const total = linesTotals(pre, settings).grandTotal;
    const approvedById = total > 0 ? await approveWithPin(prisma, clock, user, input.approvalPin) : null;
    await prisma.$transaction(async (tx) => {
      await requireOpenBill(tx, billId);
      await tx.bill.update({ where: { id: billId }, data: { status: 'CANCELLED', cancelReason: input.reason } });
      await audit(tx, { userId: user.id, action: 'bill.cancel', entity: 'Bill', entityId: billId, data: { reason: input.reason, total }, approvedById });
    });
    this.changed(billId);
    return loadBillView(prisma, billId);
  }

  async merge(user: PublicUser, targetId: string, sourceId: string): Promise<BillView> {
    const { prisma } = this.ctx;
    if (targetId === sourceId) throw badRequest('SAME_BILL', 'Pilih bill lain untuk digabung');
    const movedUnits = await prisma.$transaction(async (tx) => {
      await requireOpenShift(tx);
      for (const id of [targetId, sourceId].sort()) await lockBill(tx, id); // urutan tetap → tidak deadlock
      const [target, source] = await Promise.all([
        tx.bill.findUniqueOrThrow({ where: { id: targetId } }),
        tx.bill.findUniqueOrThrow({ where: { id: sourceId }, include: { sessions: { where: { status: { not: 'ENDED' } } } } }),
      ]);
      if (target.status !== 'OPEN' || source.status !== 'OPEN') throw conflict('BILL_NOT_OPEN', 'Hanya bill yang belum dibayar yang bisa digabung');
      await tx.billLine.updateMany({ where: { billId: sourceId }, data: { billId: targetId } });
      await tx.session.updateMany({ where: { billId: sourceId }, data: { billId: targetId } });
      await tx.bill.update({ where: { id: sourceId }, data: { status: 'CANCELLED', mergedIntoId: targetId, cancelReason: `Digabung ke ${target.number}` } });
      await tx.bill.update({ where: { id: targetId }, data: { label: `${target.label} + ${source.label}` } });
      await audit(tx, { userId: user.id, action: 'bill.merge', entity: 'Bill', entityId: targetId, data: { sourceBillId: sourceId } });
      return source.sessions.map((s) => s.unitId);
    });
    for (const unitId of movedUnits) this.ctx.bus.emit('unit.changed', unitId); // SessionView.billId berubah
    this.changed(targetId, sourceId);
    return loadBillView(prisma, targetId);
  }

  async list(filter: BillFilter): Promise<BillSummary[]> {
    const { prisma } = this.ctx;
    const settings = await getSettings(prisma);
    const rows = await prisma.bill.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.from || filter.to ? { createdAt: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lt: filter.to } : {}) } } : {}),
        ...(filter.q ? { OR: [{ number: { contains: filter.q, mode: 'insensitive' } }, { label: { contains: filter.q, mode: 'insensitive' } }] } : {}),
      },
      include: { lines: true, sessions: { select: { status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => toBillSummary(r, settings));
  }
}
```

Catatan untuk `updateLine`: PIN diverifikasi **sebelum** transaksi karena `approveWithPin` menulis ke tabel `User`; di dalam transaksi, bila qty baris ternyata naik dari perangkat lain sehingga pengurangan baru muncul tanpa persetujuan, permintaan ditolak `TOTAL_CHANGED`.

- [ ] **Step 5: `bills.routes.ts` + context + app**

```ts
import { BILL_STATUSES } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';
import { discountSchema, loadBillView } from './bill-view';

const idParam = z.object({ id: z.string().min(1) });
const lineParam = z.object({ id: z.string().min(1), lineId: z.string().min(1) });
const qty = z.number().int().min(1).max(999);
const itemSchema = z.union([
  z.object({ productId: z.string().min(1), qty }),
  z.object({ custom: z.object({ name: z.string().trim().min(1).max(60), price: z.number().int().min(0) }), qty }),
]);
const addSchema = z.object({ items: z.array(itemSchema).min(1).max(50) });
const patchSchema = z.object({ qty: qty.optional(), discount: discountSchema.nullable().optional(), approvalPin: z.string().optional() });
const pinSchema = z.object({ approvalPin: z.string().optional() });
const listSchema = z.object({
  status: z.enum(BILL_STATUSES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  q: z.string().trim().max(40).optional(),
});
const cancelSchema = z.object({ reason: z.string().trim().min(1, 'Alasan wajib diisi').max(200), approvalPin: z.string().optional() });

export function billsRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.get('/bills', auth, async (req) => {
      const f = listSchema.parse(req.query);
      return ctx.bills.list({ status: f.status, from: f.from ? new Date(f.from) : undefined, to: f.to ? new Date(f.to) : undefined, q: f.q || undefined });
    });
    app.get('/bills/:id', auth, async (req) => loadBillView(ctx.prisma, idParam.parse(req.params).id));
    app.post('/bills', auth, async (req) => ctx.bills.createStandalone(req.user!));
    app.post('/bills/:id/items', auth, async (req) => ctx.bills.addItems(req.user!, idParam.parse(req.params).id, addSchema.parse(req.body).items));
    app.patch('/bills/:id/items/:lineId', auth, async (req) => {
      const p = lineParam.parse(req.params);
      return ctx.bills.updateLine(req.user!, p.id, p.lineId, patchSchema.parse(req.body));
    });
    app.delete('/bills/:id/items/:lineId', auth, async (req) => {
      const p = lineParam.parse(req.params);
      return ctx.bills.deleteLine(req.user!, p.id, p.lineId, pinSchema.parse(req.body ?? {}).approvalPin);
    });
    app.put('/bills/:id/discount', auth, async (req) =>
      ctx.bills.setBillDiscount(req.user!, idParam.parse(req.params).id, z.object({ discount: discountSchema.nullable() }).parse(req.body).discount),
    );
    app.post('/bills/:id/cancel', auth, async (req) => ctx.bills.cancel(req.user!, idParam.parse(req.params).id, cancelSchema.parse(req.body)));
    app.post('/bills/:id/merge', auth, async (req) =>
      ctx.bills.merge(req.user!, idParam.parse(req.params).id, z.object({ sourceBillId: z.string().min(1) }).parse(req.body).sourceBillId),
    );
  };
}
```

`context.ts`: `bills: BillService;`. `app.ts`: `ctx.bills = new BillService(ctx);` dan `await api.register(billsRoutes(ctx));`.

- [ ] **Step 6: Stop membuat baris TIME**

Di `SessionService.stop` (`sessions.service.ts`), di dalam transaksi tepat setelah `const session = await tx.session.update(...)`:
```ts
      const unit = await tx.unit.findUnique({ where: { id: s.unitId }, select: { name: true } });
      const modeLabel = s.mode === 'PACKAGE' ? (s.packageName ?? 'Paket') : 'Open billing';
      await tx.billLine.create({
        data: {
          billId: s.billId,
          type: 'TIME',
          sessionId: s.id,
          nameSnapshot: `${unit?.name ?? 'Meja'} - ${modeLabel}`,
          unitPrice: charge.total,
          qty: 1,
          breakdown: charge.lines as unknown as Prisma.InputJsonValue,
          createdById: user.id,
        },
      });
```
dan setelah `this.touch(result.session.unitId);` tambah `this.ctx.bus.emit('bill.changed', result.session.billId);`.

- [ ] **Step 7: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS (bills.test baru; test stop M1 tetap lulus).

- [ ] **Step 8: Commit**

```bash
git add apps/server
git commit -m "feat(server): bills with time lines on stop, order items, discounts, cancel and merge"
```

---

### Task 8: Checkout (split payment, idempotency) & void

**Files:**
- Create: `apps/server/src/modules/billing/checkout.service.ts`, `apps/server/src/modules/billing/checkout.routes.ts`
- Modify: `apps/server/src/context.ts`, `apps/server/src/app.ts`
- Test: `apps/server/test/checkout.test.ts`

**Interfaces:**
- Consumes: `checkPayments`, `needsDiscountApproval`, `PAYMENT_METHODS`, `CheckoutResult` (Task 1–2); `linesTotals`, `billDiscountOf`, `lockBill`, `loadBillView`, `discountSchema` (Task 7); `requireOpenShift`, `shiftSummary` (Task 5); `approveWithPin`, `getSettings` (M1).
- Produces: `CheckoutService` di `ctx.checkout`: `checkout(user, billId, input: CheckoutInput): Promise<CheckoutResult>`, `void(user, billId, { reason, approvalPin? }): Promise<BillView>`; route `POST /api/bills/:id/checkout`, `POST /api/bills/:id/void`. Task 9 menyisipkan pemanggilan cetak di titik "setelah commit".
- `CheckoutInput = { idempotencyKey: string; expectedGrandTotal: number; payments: PaymentInput[]; approvalPin?: string }` (diskon bill sudah disimpan lewat `PUT /bills/:id/discount`).

Kode error: `BILL_NOT_OPEN`, `SESSION_ACTIVE`, `BILL_EMPTY` (400), `NO_OPEN_SHIFT`, `TOTAL_CHANGED` (409), `APPROVAL_REQUIRED`/`PIN_INVALID` (403), `PAYMENT_INSUFFICIENT`/`PAYMENT_INVALID` (400), `REQUEST_ID_USED` (409), `BILL_NOT_PAID` (409, void).

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/checkout.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let users: Awaited<ReturnType<typeof seedUsers>>;
let cookie: string;
let teh: { id: string };
let shiftId: string;

beforeEach(async () => {
  await resetDb();
  users = await seedUsers();
  b = await seedBasics();
  shiftId = (await openShift(users.kasir.id, 100000)).id;
  const cat = await prisma.category.create({ data: { name: 'Minuman' } });
  teh = await prisma.product.create({ data: { name: 'Es Teh', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 10 } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(() => t.app.close());

const req = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown) =>
  t.app.inject({ method, url, headers: { cookie }, payload: payload as object });

/** Meja 1 open billing 60 menit (Rp40.000) + 2 Es Teh (Rp16.000) = Rp56.000. */
async function readyBill(): Promise<string> {
  const s = (await req('POST', '/api/sessions', { unitId: b.m1.id, mode: 'OPEN' })).json().unit.session;
  await req('POST', `/api/bills/${s.billId}/items`, { items: [{ productId: teh.id, qty: 2 }] });
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${s.id}/stop`, {});
  return s.billId;
}

const pay = (billId: string, body: Record<string, unknown>) =>
  req('POST', `/api/bills/${billId}/checkout`, { idempotencyKey: 'key-0000001', expectedGrandTotal: 56000, payments: [{ method: 'CASH', amount: 56000, received: 100000 }], ...body });

describe('checkout', () => {
  it('split tunai + QRIS: PAID, stok berkurang, rekap shift', async () => {
    const billId = await readyBill();
    const res = await pay(billId, { payments: [{ method: 'CASH', amount: 30000, received: 50000 }, { method: 'QRIS', amount: 26000, reference: 'QR-1' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().change).toBe(20000);
    expect(res.json().bill).toMatchObject({ status: 'PAID', shiftId, stored: { subtotal: 56000, grandTotal: 56000 } });
    expect(res.json().bill.payments).toHaveLength(2);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: teh.id } })).stockQty).toBe(8);
    expect(await prisma.stockMovement.findMany({ select: { qty: true, reason: true } })).toEqual([{ qty: -2, reason: 'SALE' }]);
    const summary = (await req('GET', '/api/shifts/current')).json().summary;
    expect(summary).toMatchObject({ sales: { CASH: 30000, QRIS: 26000 }, expectedCash: 130000, billCount: 1 });
  });

  it('total berubah dari perangkat lain → TOTAL_CHANGED, tidak ada pembayaran', async () => {
    const billId = await readyBill();
    await req('POST', `/api/bills/${billId}/items`, { items: [{ productId: teh.id, qty: 1 }] });
    const res = await pay(billId, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('TOTAL_CHANGED');
    expect(await prisma.payment.count()).toBe(0);
  });

  it('idempotency: key sama dua kali → hasil sama, pembayaran tidak ganda', async () => {
    const billId = await readyBill();
    const a = await pay(billId, {});
    const c = await pay(billId, {});
    expect(c.statusCode).toBe(200);
    expect(c.json().bill.id).toBe(a.json().bill.id);
    expect(c.json().change).toBe(44000);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('checkout paralel dengan key berbeda → tepat satu berhasil', async () => {
    const billId = await readyBill();
    const [x, y] = await Promise.all([pay(billId, { idempotencyKey: 'key-aaaaaaa' }), pay(billId, { idempotencyKey: 'key-bbbbbbb' })]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.statusCode === 409)!.json().error.code).toBe('BILL_NOT_OPEN');
    expect(await prisma.payment.count()).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: teh.id } })).stockQty).toBe(8);
  });

  it('checkout paralel dengan key sama → keduanya 200, satu set pembayaran', async () => {
    const billId = await readyBill();
    const [x, y] = await Promise.all([pay(billId, {}), pay(billId, {})]);
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]);
    expect(await prisma.payment.count()).toBe(1);
  });

  it('key yang sudah dipakai bill lain → REQUEST_ID_USED', async () => {
    const billId = await readyBill();
    await pay(billId, {});
    const other = (await req('POST', '/api/bills')).json();
    await req('POST', `/api/bills/${other.id}/items`, { items: [{ productId: teh.id, qty: 1 }] });
    const res = await req('POST', `/api/bills/${other.id}/checkout`, { idempotencyKey: 'key-0000001', expectedGrandTotal: 8000, payments: [{ method: 'CASH', amount: 8000 }] });
    expect(res.json().error.code).toBe('REQUEST_ID_USED');
  });

  it('sesi masih berjalan, tanpa shift, bill kosong, pembayaran kurang', async () => {
    const s = (await req('POST', '/api/sessions', { unitId: b.m2.id, mode: 'OPEN' })).json().unit.session;
    expect((await pay(s.billId, {})).json().error.code).toBe('SESSION_ACTIVE');
    const empty = (await req('POST', '/api/bills')).json();
    expect((await pay(empty.id, { expectedGrandTotal: 0, payments: [] })).json().error.code).toBe('BILL_EMPTY');
    const billId = await readyBill();
    expect((await pay(billId, { payments: [{ method: 'CARD', amount: 50000 }] })).json().error.code).toBe('PAYMENT_INSUFFICIENT');
    await req('POST', '/api/shifts/current/close', { countedCash: 0 });
    expect((await pay(billId, {})).json().error.code).toBe('NO_OPEN_SHIFT');
  });

  it('diskon di atas batas: kasir butuh PIN; sesuai batas tidak', async () => {
    const billId = await readyBill();
    await req('PUT', `/api/bills/${billId}/discount`, { discount: { type: 'PERCENT', value: 20 } });
    const body = { expectedGrandTotal: 44800, payments: [{ method: 'CASH', amount: 44800 }] };
    expect((await pay(billId, body)).json().error.code).toBe('APPROVAL_REQUIRED');
    const ok = await pay(billId, { ...body, approvalPin: '1111' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().bill.stored).toMatchObject({ discountTotal: 11200, grandTotal: 44800 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'bill.paid' } });
    expect(log.approvedById).toBe(users.supervisor.id);

    const other = await readyBillOn(b.m2.id);
    await req('PUT', `/api/bills/${other}/discount`, { discount: { type: 'PERCENT', value: 10 } });
    expect((await pay(other, { idempotencyKey: 'key-0000002', expectedGrandTotal: 50400, payments: [{ method: 'CASH', amount: 50400 }] })).statusCode).toBe(200);
  });

  it('pajak & service dari pengaturan masuk ke total tersimpan', async () => {
    await prisma.setting.update({ where: { id: 1 }, data: { taxPct: 10, taxScope: 'ALL', servicePct: 5, serviceScope: 'FNB' } });
    const billId = await readyBill();
    // service 5% × 16000 = 800; pajak 10% × (56000 + 800) = 5680 → 62480
    const res = await pay(billId, { expectedGrandTotal: 62480, payments: [{ method: 'CARD', amount: 62480 }] });
    expect(res.json().bill.stored).toEqual({ subtotal: 56000, discountTotal: 0, serviceTotal: 800, taxTotal: 5680, grandTotal: 62480 });
  });

  it('bill dari shift lama dibayar di shift baru → masuk rekap shift baru', async () => {
    const billId = await readyBill();
    await req('POST', '/api/shifts/current/close', { countedCash: 100000 });
    const next = (await req('POST', '/api/shifts', { openingCash: 50000 })).json().summary.shift.id;
    await pay(billId, { payments: [{ method: 'CASH', amount: 56000 }] });
    expect((await prisma.payment.findFirstOrThrow()).shiftId).toBe(next);
    expect((await req('GET', `/api/shifts/${shiftId}`)).json()).toMatchObject({ sales: { CASH: 0 }, expectedCash: 100000 });
    expect((await req('GET', `/api/shifts/${next}`)).json()).toMatchObject({ sales: { CASH: 56000 }, expectedCash: 106000 });
  });
});

async function readyBillOn(unitId: string): Promise<string> {
  t.clock.set(new Date('2026-10-01T03:00:00Z'));
  const s = (await req('POST', '/api/sessions', { unitId, mode: 'OPEN' })).json().unit.session;
  await req('POST', `/api/bills/${s.billId}/items`, { items: [{ productId: teh.id, qty: 2 }] });
  t.clock.advanceMinutes(60);
  await req('POST', `/api/sessions/${s.id}/stop`, {});
  return s.billId;
}

describe('void', () => {
  it('kasir butuh PIN; stok kembali tepat sekali; rekap shift dikurangi', async () => {
    const billId = await readyBill();
    await pay(billId, { payments: [{ method: 'CASH', amount: 56000, received: 60000 }] });
    expect((await req('POST', `/api/bills/${billId}/void`, { reason: 'salah input' })).json().error.code).toBe('APPROVAL_REQUIRED');
    const [x, y] = await Promise.all([
      req('POST', `/api/bills/${billId}/void`, { reason: 'salah input', approvalPin: '1111' }),
      req('POST', `/api/bills/${billId}/void`, { reason: 'salah input', approvalPin: '1111' }),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([200, 409]);
    expect([x, y].find((r) => r.statusCode === 409)!.json().error.code).toBe('BILL_NOT_PAID');
    expect((await prisma.product.findUniqueOrThrow({ where: { id: teh.id } })).stockQty).toBe(10);
    expect(await prisma.stockMovement.count({ where: { reason: 'VOID' } })).toBe(1);
    const bill = (await req('GET', `/api/bills/${billId}`)).json();
    expect(bill).toMatchObject({ status: 'VOID', voidReason: 'salah input' });
    const summary = (await req('GET', '/api/shifts/current')).json().summary;
    expect(summary).toMatchObject({ sales: { CASH: 56000 }, voids: { CASH: 56000 }, voidCount: 1, expectedCash: 100000 });
  });

  it('bill OPEN tidak bisa di-void', async () => {
    const billId = await readyBill();
    expect((await req('POST', `/api/bills/${billId}/void`, { reason: 'x', approvalPin: '1111' })).json().error.code).toBe('BILL_NOT_PAID');
  });
});
```

Angka: diskon 20% dari 56000 = 11200 → 44800; diskon 10% = 5600 → 50400 (sama dengan batas → tanpa PIN).

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- checkout`
Expected: FAIL — 404.

- [ ] **Step 3: Implementasi**

`apps/server/src/modules/billing/checkout.service.ts`:
```ts
import { Prisma } from '@prisma/client';
import { checkPayments, needsDiscountApproval, type BillView, type CheckoutResult, type PaymentInput, type PublicUser } from '@funplay/shared';
import type { AppContext } from '../../context';
import type { Db } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { approveWithPin } from '../auth/auth.service';
import { getSettings } from '../settings/settings.service';
import { requireOpenShift } from '../shifts/shifts.service';
import { linesTotals, loadBillView, lockBill } from './bill-view';

export interface CheckoutInput { idempotencyKey: string; expectedGrandTotal: number; payments: PaymentInput[]; approvalPin?: string }

/** Jumlah per produk stok di bill (baris produk sama bisa lebih dari satu bila harganya berbeda). */
function stockQtyByProduct(lines: { type: string; productId: string | null; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of lines) if (l.type === 'PRODUCT' && l.productId) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
  return m;
}

export class CheckoutService {
  constructor(private readonly ctx: AppContext) {}

  /** Hasil checkout sebelumnya untuk key ini (null bila belum ada). */
  private async prior(db: Db, billId: string, key: string): Promise<{ billId: string; change: number } | null> {
    const b = await db.bill.findUnique({ where: { checkoutKey: key }, include: { payments: true } });
    if (!b) return null;
    if (b.id !== billId) throw conflict('REQUEST_ID_USED', 'ID pembayaran sudah dipakai untuk bill lain');
    return { billId: b.id, change: b.payments.reduce((a, p) => a + (p.change ?? 0), 0) };
  }

  async checkout(user: PublicUser, billId: string, input: CheckoutInput): Promise<CheckoutResult> {
    const { prisma, clock } = this.ctx;
    const finish = async (r: { billId: string; change: number }) => ({ bill: await loadBillView(prisma, r.billId), change: r.change });

    const done = await this.prior(prisma, billId, input.idempotencyKey);
    if (done) return finish(done);

    const settings = await getSettings(prisma);
    const pre = await prisma.bill.findUnique({ where: { id: billId }, include: { lines: true } });
    if (!pre) throw notFound('Bill');
    // PIN diverifikasi di luar transaksi (approveWithPin menulis ke tabel User).
    const approvedById = needsDiscountApproval(linesTotals(pre, settings), settings.discountApprovalPct)
      ? await approveWithPin(prisma, clock, user, input.approvalPin)
      : null;

    let result: { billId: string; change: number };
    try {
      result = await prisma.$transaction(async (tx) => {
        await lockBill(tx, billId);
        const again = await this.prior(tx, billId, input.idempotencyKey); // request kembar yang baru selesai
        if (again) return again;
        const bill = await tx.bill.findUniqueOrThrow({
          where: { id: billId },
          include: { lines: true, sessions: { where: { status: { not: 'ENDED' } }, select: { id: true } } },
        });
        if (bill.status !== 'OPEN') throw conflict('BILL_NOT_OPEN', 'Bill sudah dibayar atau dibatalkan');
        if (bill.sessions.length) throw conflict('SESSION_ACTIVE', 'Hentikan sesi meja terlebih dahulu');
        if (!bill.lines.length) throw badRequest('BILL_EMPTY', 'Bill masih kosong');
        const shift = await requireOpenShift(tx);

        const totals = linesTotals(bill, settings);
        if (totals.grandTotal !== input.expectedGrandTotal) throw conflict('TOTAL_CHANGED', 'Total tagihan berubah. Periksa kembali sebelum membayar.');
        if (needsDiscountApproval(totals, settings.discountApprovalPct) && !approvedById) {
          throw conflict('TOTAL_CHANGED', 'Diskon berubah. Periksa kembali sebelum membayar.');
        }
        const pay = checkPayments(totals.grandTotal, input.payments);
        if (!pay.ok) throw badRequest(pay.code, pay.message);

        const now = clock.now();
        for (const p of pay.payments) {
          await tx.payment.create({
            data: { billId, shiftId: shift.id, method: p.method, amount: p.amount, received: p.received, change: p.change, reference: p.reference, createdAt: now },
          });
        }
        for (const [productId, qty] of stockQtyByProduct(bill.lines)) {
          await tx.product.update({ where: { id: productId }, data: { stockQty: { decrement: qty } } });
          await tx.stockMovement.create({ data: { productId, qty: -qty, reason: 'SALE', billId, userId: user.id } });
        }
        await tx.bill.update({
          where: { id: billId },
          data: {
            status: 'PAID', paidAt: now, paidById: user.id, shiftId: shift.id, checkoutKey: input.idempotencyKey,
            subtotal: totals.subtotal, discountTotal: totals.discountTotal, serviceTotal: totals.serviceTotal, taxTotal: totals.taxTotal, grandTotal: totals.grandTotal,
          },
        });
        await audit(tx, {
          userId: user.id, action: 'bill.paid', entity: 'Bill', entityId: billId, approvedById,
          data: { grandTotal: totals.grandTotal, discountTotal: totals.discountTotal, change: pay.change, payments: pay.payments.map((p) => ({ method: p.method, amount: p.amount })) },
        });
        return { billId, change: pay.change };
      });
    } catch (err) {
      // Dua request kembar lolos bersamaan: yang kalah menabrak unik checkoutKey → kembalikan hasil pemenang.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && String(err.meta?.target ?? '').includes('checkoutKey')) {
        const won = await this.prior(prisma, billId, input.idempotencyKey);
        if (won) return finish(won);
      }
      throw err;
    }

    this.ctx.bus.emit('bill.changed', billId);
    this.ctx.bus.emit('shift.changed');
    // (Task 9) cetak struk setelah commit
    return finish(result);
  }

  async void(user: PublicUser, billId: string, input: { reason: string; approvalPin?: string }): Promise<BillView> {
    const { prisma, clock } = this.ctx;
    const approvedById = await approveWithPin(prisma, clock, user, input.approvalPin);
    await prisma.$transaction(async (tx) => {
      await lockBill(tx, billId);
      const bill = await tx.bill.findUniqueOrThrow({ where: { id: billId }, include: { lines: true } });
      if (bill.status !== 'PAID') throw conflict('BILL_NOT_PAID', 'Hanya bill lunas yang bisa di-void');
      const shift = await requireOpenShift(tx);
      for (const [productId, qty] of stockQtyByProduct(bill.lines)) {
        await tx.product.update({ where: { id: productId }, data: { stockQty: { increment: qty } } });
        await tx.stockMovement.create({ data: { productId, qty, reason: 'VOID', billId, userId: user.id } });
      }
      await tx.bill.update({
        where: { id: billId },
        data: { status: 'VOID', voidReason: input.reason, voidedById: user.id, voidedAt: clock.now(), voidShiftId: shift.id },
      });
      await audit(tx, { userId: user.id, action: 'bill.void', entity: 'Bill', entityId: billId, approvedById, data: { reason: input.reason, grandTotal: bill.grandTotal } });
    });
    this.ctx.bus.emit('bill.changed', billId);
    this.ctx.bus.emit('shift.changed');
    return loadBillView(prisma, billId);
  }
}
```

`apps/server/src/modules/billing/checkout.routes.ts`:
```ts
import { PAYMENT_METHODS } from '@funplay/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { requireAuth } from '../auth/guard';

const idParam = z.object({ id: z.string().min(1) });
const checkoutSchema = z.object({
  idempotencyKey: z.string().min(8).max(64),
  expectedGrandTotal: z.number().int().min(0),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS),
        amount: z.number().int(),
        received: z.number().int().nullable().optional(),
        reference: z.string().trim().max(60).nullable().optional(),
      }),
    )
    .max(8),
  approvalPin: z.string().optional(),
});
const voidSchema = z.object({ reason: z.string().trim().min(1, 'Alasan wajib diisi').max(200), approvalPin: z.string().optional() });

export function checkoutRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };
    app.post('/bills/:id/checkout', auth, async (req) => ctx.checkout.checkout(req.user!, idParam.parse(req.params).id, checkoutSchema.parse(req.body)));
    app.post('/bills/:id/void', auth, async (req) => ctx.checkout.void(req.user!, idParam.parse(req.params).id, voidSchema.parse(req.body)));
  };
}
```

`context.ts`: `checkout: CheckoutService;`. `app.ts`: `ctx.checkout = new CheckoutService(ctx);` dan `await api.register(checkoutRoutes(ctx));`.

Catatan void paralel: kedua request lolos `approveWithPin`, lalu `lockBill` membuat yang kedua menunggu; setelah yang pertama commit status sudah `VOID` → `BILL_NOT_PAID`. `@@unique([billId, productId, reason])` pada `StockMovement` menjadi jaring kedua.

- [ ] **Step 4: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): idempotent checkout with split payments, stock and void"
```

---

### Task 9: Printing — antrean cetak, driver Simulator/USB/LAN, struk otomatis & rekap shift

**Files:**
- Create: `apps/server/src/modules/printing/printer.ts`, `apps/server/src/modules/printing/receipt-model.ts`, `apps/server/src/modules/printing/print.service.ts`, `apps/server/src/modules/printing/printing.routes.ts`
- Modify: `apps/server/src/context.ts`, `apps/server/src/app.ts`, `apps/server/src/modules/billing/checkout.service.ts`, `apps/server/src/modules/shifts/shifts.service.ts`, `apps/server/test/helpers.ts`
- Test: `apps/server/test/printing.test.ts`

**Interfaces:**
- Consumes: `renderReceipt`, `renderShiftReport`, `renderTestPage`, `toPlainText`, `encodeEscPos`, `formatReceiptDate`, `PAYMENT_METHOD_LABEL`, `PrintJobView` (Task 1, 3); `linesTotals`, `billDiscountOf` (Task 7); `shiftSummary`, `userNames` (Task 5); `withTimeout` (M1 `lib/timeout.ts`); `localHHMM` (shared M1).
- Produces:
  - `Printer { send(bytes: Uint8Array): Promise<void> }`, `SimulatorPrinter`, `LanPrinter(host, port, timeoutMs = 5000)`, `UsbPrinter(path, timeoutMs = 5000)`, `type PrinterFactory = (s: PublicSettings) => Printer`, `defaultPrinterFactory`.
  - `PrintService` di `ctx.printing`: `printReceipt(userId, billId, reprint = false)`, `printShiftReport(userId, shiftId)`, `printTest(userId)`, `listJobs(limit)` → `PrintJobView`/`PrintJobView[]`; `later(task)` (fire-and-forget tercatat), `idle()`. Job dibuat `PENDING` dengan `previewText`, dikirim tanpa ditunggu, lalu `DONE`/`FAILED`; setiap perubahan memancarkan `print.job`.
  - `BuildAppDeps.printerFactory?: PrinterFactory`; `makeApp({ printerFactory })` di helpers.
  - Route: `POST /api/bills/:id/print` (cetak ulang; bill PAID/VOID, audit `bill.reprint`), `POST /api/shifts/:id/print`, `POST /api/print/test` (OWNER), `GET /api/print/jobs?limit=` (terbaru dulu).
  - Checkout memanggil `printReceipt` setelah commit; tutup shift memanggil `printShiftReport` setelah commit. Kegagalan cetak hanya mengubah job menjadi `FAILED` (+ log), tidak pernah melempar ke pemanggil.

- [ ] **Step 1: Tulis test yang gagal**

`apps/server/test/printing.test.ts`:
```ts
import { createServer, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginAs, makeApp, openShift, prisma, resetDb, seedBasics, seedUsers } from './helpers';

let t: Awaited<ReturnType<typeof makeApp>>;
let b: Awaited<ReturnType<typeof seedBasics>>;
let cookie: string;
let teh: { id: string };
let tcp: Server | null = null;

beforeEach(async () => {
  await resetDb();
  const users = await seedUsers();
  b = await seedBasics();
  await openShift(users.kasir.id, 100000);
  const cat = await prisma.category.create({ data: { name: 'Minuman' } });
  teh = await prisma.product.create({ data: { name: 'Es Teh', categoryId: cat.id, kind: 'STOCK', price: 8000, stockQty: 10 } });
  t = await makeApp();
  cookie = await loginAs(t.app, 'kasir');
});
afterEach(async () => {
  await t.app.close();
  await new Promise<void>((r) => (tcp ? tcp.close(() => r()) : r()));
  tcp = null;
});

const req = (method: 'GET' | 'POST', url: string, payload?: unknown, c = cookie) => t.app.inject({ method, url, headers: { cookie: c }, payload: payload as object });

async function paidBill(): Promise<string> {
  const bill = (await req('POST', '/api/bills')).json();
  await req('POST', `/api/bills/${bill.id}/items`, { items: [{ productId: teh.id, qty: 1 }] });
  const res = await req('POST', `/api/bills/${bill.id}/checkout`, { idempotencyKey: `key-${bill.id}`, expectedGrandTotal: 8000, payments: [{ method: 'CASH', amount: 8000, received: 10000 }] });
  expect(res.statusCode).toBe(200);
  return bill.id;
}

const jobs = () => prisma.printJob.findMany({ orderBy: { createdAt: 'asc' } });

describe('struk', () => {
  it('simulator: checkout membuat job RECEIPT DONE dengan pratinjau struk', async () => {
    const billId = await paidBill();
    await vi.waitFor(async () => expect((await jobs())[0]?.status).toBe('DONE'));
    const [job] = await jobs();
    expect(job).toMatchObject({ kind: 'RECEIPT', billId });
    expect(job!.previewText).toContain('FP-20261001-0001');
    expect(job!.previewText).toContain('Es Teh');
    expect(job!.previewText).toMatch(/TOTAL\s+8\.000/);
    expect(job!.previewText).toMatch(/Kembalian\s+2\.000/);
  });

  it('LAN: byte ESC/POS sampai ke printer', async () => {
    const received: Buffer[] = [];
    tcp = createServer((sock) => sock.on('data', (d) => received.push(d)));
    await new Promise<void>((r) => tcp!.listen(0, '127.0.0.1', () => r()));
    const port = (tcp.address() as { port: number }).port;
    await prisma.setting.update({ where: { id: 1 }, data: { printerDriver: 'LAN', printerHost: '127.0.0.1', printerPort: port } });
    await paidBill();
    await vi.waitFor(async () => expect((await jobs())[0]?.status).toBe('DONE'));
    await vi.waitFor(() => expect(Buffer.concat(received).includes(Buffer.from('TOTAL'))).toBe(true));
    expect([...Buffer.concat(received).subarray(0, 2)]).toEqual([0x1b, 0x40]);
  });

  it('printer gagal: bill tetap PAID, job FAILED; cetak ulang membuat job baru tanpa pembayaran baru', async () => {
    const dead = createServer();
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', () => r()));
    const port = (dead.address() as { port: number }).port;
    await new Promise<void>((r) => dead.close(() => r())); // port tertutup → koneksi ditolak
    await prisma.setting.update({ where: { id: 1 }, data: { printerDriver: 'LAN', printerHost: '127.0.0.1', printerPort: port } });
    const billId = await paidBill();
    await vi.waitFor(async () => expect((await jobs())[0]?.status).toBe('FAILED'));
    expect((await jobs())[0]!.error).toMatch(/Printer LAN/);
    expect((await prisma.bill.findUniqueOrThrow({ where: { id: billId } })).status).toBe('PAID');

    await prisma.setting.update({ where: { id: 1 }, data: { printerDriver: 'SIMULATOR' } });
    const re = await req('POST', `/api/bills/${billId}/print`);
    expect(re.statusCode).toBe(200);
    expect(re.json().previewText).toContain('** CETAK ULANG **');
    await vi.waitFor(async () => expect((await jobs()).map((j) => j.status)).toEqual(['FAILED', 'DONE']));
    expect(await prisma.payment.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'bill.reprint' } })).toBe(1);
  });

  it('cetak ulang bill OPEN ditolak; daftar job terbaru dulu', async () => {
    const open = (await req('POST', '/api/bills')).json();
    expect((await req('POST', `/api/bills/${open.id}/print`)).json().error.code).toBe('BILL_NOT_PAID');
    await paidBill();
    await vi.waitFor(async () => expect((await jobs())[0]?.status).toBe('DONE'));
    const list = (await req('GET', '/api/print/jobs?limit=5')).json();
    expect(list[0]).toMatchObject({ kind: 'RECEIPT', status: 'DONE' });
  });
});

describe('rekap shift & tes cetak', () => {
  it('tutup shift mencetak rekap', async () => {
    await req('POST', '/api/shifts/current/close', { countedCash: 100000 });
    await vi.waitFor(async () => expect((await jobs())[0]).toMatchObject({ kind: 'SHIFT_REPORT', status: 'DONE' }));
    expect((await jobs())[0]!.previewText).toContain('REKAP SHIFT');
  });

  it('tes cetak hanya owner', async () => {
    expect((await req('POST', '/api/print/test')).statusCode).toBe(403);
    const owner = await loginAs(t.app, 'owner');
    const res = await req('POST', '/api/print/test', undefined, owner);
    expect(res.json()).toMatchObject({ kind: 'TEST' });
    expect(res.json().previewText).toContain('TES CETAK');
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/server test -- printing`
Expected: FAIL — tidak ada job / 404.

- [ ] **Step 3: Driver printer**

`apps/server/src/modules/printing/printer.ts`:
```ts
import { writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import type { PublicSettings } from '@funplay/shared';
import { withTimeout } from '../../lib/timeout';

export interface Printer {
  send(bytes: Uint8Array): Promise<void>;
}

/** Tidak mengirim ke mana pun; pratinjau diambil dari PrintJob.previewText. */
export class SimulatorPrinter implements Printer {
  async send(): Promise<void> {}
}

/** Raw TCP (port 9100). Selesai saat semua byte terkirim ke OS. */
export class LanPrinter implements Printer {
  constructor(private readonly host: string, private readonly port: number, private readonly timeoutMs = 5000) {}

  send(bytes: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = connect({ host: this.host, port: this.port });
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`Printer LAN ${this.host}:${this.port} tidak merespons`));
      }, this.timeoutMs);
      sock.once('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`Printer LAN ${this.host}:${this.port} gagal: ${e.message}`));
      });
      sock.once('connect', () => {
        sock.end(Buffer.from(bytes), () => {
          clearTimeout(timer);
          resolve();
        });
      });
    });
  }
}

/** Printer USB di server lewat device file (mis. /dev/usb/lp0). */
export class UsbPrinter implements Printer {
  constructor(private readonly path: string, private readonly timeoutMs = 5000) {}

  async send(bytes: Uint8Array): Promise<void> {
    try {
      await withTimeout(writeFile(this.path, bytes), this.timeoutMs);
    } catch (e) {
      throw new Error(`Printer USB ${this.path} gagal: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export type PrinterFactory = (s: PublicSettings) => Printer;

export const defaultPrinterFactory: PrinterFactory = (s) => {
  if (s.printerDriver === 'LAN') return new LanPrinter(s.printerHost, s.printerPort);
  if (s.printerDriver === 'USB') return new UsbPrinter(s.printerDevicePath);
  return new SimulatorPrinter();
};
```

- [ ] **Step 4: Model struk dari bill & shift**

`apps/server/src/modules/printing/receipt-model.ts`:
```ts
import {
  formatReceiptDate, localHHMM, PAYMENT_METHOD_LABEL, PAYMENT_METHODS,
  type ChargeLine, type PublicSettings, type ReceiptModel, type ShiftReportModel,
} from '@funplay/shared';
import type { Db } from '../../db';
import { notFound } from '../../lib/errors';
import { shiftSummary, userNames } from '../shifts/shifts.service';
import { linesTotals } from '../billing/bill-view';

const minutesLabel = (m: number) => (m % 60 === 0 ? `${m / 60} jam` : m > 60 ? `${Math.floor(m / 60)} jam ${m % 60} mnt` : `${m} mnt`);

export async function buildReceiptModel(db: Db, billId: string, settings: PublicSettings, now: Date, reprint: boolean): Promise<ReceiptModel> {
  const b = await db.bill.findUnique({
    where: { id: billId },
    include: { lines: { orderBy: { createdAt: 'asc' } }, payments: { orderBy: { createdAt: 'asc' } }, sessions: { include: { unit: { select: { name: true } } }, orderBy: { startedAt: 'asc' } } },
  });
  if (!b) throw notFound('Bill');
  const names = await userNames(db, [b.paidById, b.createdById]);
  const totals = linesTotals(b, settings);
  const off = settings.utcOffsetMin;
  return {
    outletName: settings.outletName,
    address: settings.address,
    header: settings.receiptHeader,
    footer: settings.receiptFooter,
    billNumber: b.number,
    printedAt: formatReceiptDate(b.paidAt ?? now, off),
    cashier: names.get(b.paidById ?? b.createdById) ?? '-',
    label: b.label,
    sessions: b.sessions
      .filter((s) => s.endedAt)
      .map((s) => ({ unitName: s.unit.name, start: localHHMM(s.startedAt, off), end: localHHMM(s.endedAt!, off) })),
    lines: b.lines.map((l, i) => ({
      name: l.nameSnapshot,
      qty: l.qty,
      unitPrice: l.unitPrice,
      amount: l.unitPrice * l.qty,
      discount: totals.lines[i]!.itemDiscount,
      details: ((l.breakdown as ChargeLine[] | null) ?? []).map((c) => `${c.label} ${minutesLabel(c.minutes)}`),
    })),
    subtotal: b.subtotal,
    discountTotal: b.discountTotal,
    serviceTotal: b.serviceTotal,
    taxTotal: b.taxTotal,
    grandTotal: b.grandTotal,
    payments: b.payments.map((p) => ({ label: p.reference ? `${PAYMENT_METHOD_LABEL[p.method]} ${p.reference}` : PAYMENT_METHOD_LABEL[p.method], amount: p.received ?? p.amount })),
    change: b.payments.reduce((a, p) => a + (p.change ?? 0), 0),
    copy: b.status === 'VOID' ? 'VOID' : reprint ? 'REPRINT' : null,
  };
}

export async function buildShiftReportModel(db: Db, shiftId: string, settings: PublicSettings, now: Date): Promise<ShiftReportModel> {
  const s = await db.shift.findUnique({ where: { id: shiftId } });
  if (!s) throw notFound('Shift');
  const sum = await shiftSummary(db, s);
  const off = settings.utcOffsetMin;
  const rows = (rec: Record<string, number>) => PAYMENT_METHODS.filter((m) => rec[m]).map((m) => ({ label: PAYMENT_METHOD_LABEL[m], amount: rec[m]! }));
  return {
    outletName: settings.outletName,
    openedAt: formatReceiptDate(s.openedAt, off),
    closedAt: formatReceiptDate(s.closedAt ?? now, off),
    openedBy: sum.shift.openedByName,
    closedBy: sum.shift.closedByName ?? '-',
    openingCash: s.openingCash,
    sales: rows(sum.sales),
    voids: rows(sum.voids),
    billCount: sum.billCount,
    voidCount: sum.voidCount,
    expectedCash: s.expectedCash ?? sum.expectedCash,
    countedCash: s.countedCash ?? 0,
    note: s.note,
  };
}
```
Baris pembayaran tunai pada struk menampilkan uang yang diterima (`received`), lalu "Kembalian".

- [ ] **Step 5: Service, route, dan pemasangan**

`apps/server/src/modules/printing/print.service.ts`:
```ts
import type { PrintJob, PrintKind } from '@prisma/client';
import { encodeEscPos, formatReceiptDate, renderReceipt, renderShiftReport, renderTestPage, toPlainText, type PrintJobView, type PrintLine } from '@funplay/shared';
import type { AppContext } from '../../context';
import { getSettings } from '../settings/settings.service';
import type { PrinterFactory } from './printer';
import { buildReceiptModel, buildShiftReportModel } from './receipt-model';

const toView = (j: PrintJob): PrintJobView => ({
  id: j.id, kind: j.kind, status: j.status, error: j.error, previewText: j.previewText, billId: j.billId, shiftId: j.shiftId, createdAt: j.createdAt.toISOString(),
});

export class PrintService {
  private readonly pending = new Set<Promise<unknown>>();

  constructor(private readonly ctx: AppContext, private readonly factory: PrinterFactory) {}

  /** Jalankan tugas cetak setelah commit: tidak ditunggu pemanggil dan tidak pernah melempar. */
  later(task: () => Promise<unknown>): void {
    this.track(task().catch((err: unknown) => console.error('tugas cetak gagal', err)));
  }

  /** Tunggu semua tugas cetak selesai (dipakai saat app ditutup agar tidak ada kerja menggantung). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private track(p: Promise<unknown>): void {
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  async printReceipt(userId: string, billId: string, reprint = false): Promise<PrintJobView> {
    const settings = await getSettings(this.ctx.prisma);
    const lines = renderReceipt(await buildReceiptModel(this.ctx.prisma, billId, settings, this.ctx.clock.now(), reprint));
    return this.enqueue('RECEIPT', { billId }, lines, userId);
  }

  async printShiftReport(userId: string, shiftId: string): Promise<PrintJobView> {
    const settings = await getSettings(this.ctx.prisma);
    const lines = renderShiftReport(await buildShiftReportModel(this.ctx.prisma, shiftId, settings, this.ctx.clock.now()));
    return this.enqueue('SHIFT_REPORT', { shiftId }, lines, userId);
  }

  async printTest(userId: string): Promise<PrintJobView> {
    const settings = await getSettings(this.ctx.prisma);
    return this.enqueue('TEST', {}, renderTestPage(settings.outletName, formatReceiptDate(this.ctx.clock.now(), settings.utcOffsetMin)), userId);
  }

  async listJobs(limit: number): Promise<PrintJobView[]> {
    return (await this.ctx.prisma.printJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit })).map(toView);
  }

  private async enqueue(kind: PrintKind, refs: { billId?: string; shiftId?: string }, lines: PrintLine[], userId: string): Promise<PrintJobView> {
    const job = await this.ctx.prisma.printJob.create({
      data: { kind, billId: refs.billId ?? null, shiftId: refs.shiftId ?? null, previewText: toPlainText(lines), requestedById: userId },
    });
    const view = toView(job);
    this.ctx.bus.emit('print.job', view);
    this.track(this.deliver(job.id, lines));
    return view;
  }

  /** Tidak pernah melempar: kegagalan dicatat di job. */
  private async deliver(jobId: string, lines: PrintLine[]): Promise<void> {
    const { prisma } = this.ctx;
    let status: 'DONE' | 'FAILED' = 'DONE';
    let error: string | null = null;
    try {
      const settings = await getSettings(prisma);
      await this.factory(settings).send(encodeEscPos(lines));
    } catch (e) {
      status = 'FAILED';
      error = e instanceof Error ? e.message : String(e);
    }
    try {
      const job = await prisma.printJob.update({ where: { id: jobId }, data: { status, error } });
      this.ctx.bus.emit('print.job', toView(job));
    } catch {
      // job bisa hilang bila DB direset (test); abaikan
    }
  }
}
```

`apps/server/src/modules/printing/printing.routes.ts`:
```ts
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit';
import { requireAuth, requireRole } from '../auth/guard';

const idParam = z.object({ id: z.string().min(1) });
const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

export function printingRoutes(ctx: AppContext): FastifyPluginAsync {
  return async (app) => {
    const auth = { preHandler: requireAuth };

    app.post('/bills/:id/print', auth, async (req) => {
      const { id } = idParam.parse(req.params);
      const bill = await ctx.prisma.bill.findUnique({ where: { id }, select: { status: true } });
      if (!bill) throw notFound('Bill');
      if (bill.status !== 'PAID' && bill.status !== 'VOID') throw conflict('BILL_NOT_PAID', 'Struk hanya untuk bill yang sudah dibayar');
      await audit(ctx.prisma, { userId: req.user!.id, action: 'bill.reprint', entity: 'Bill', entityId: id });
      return ctx.printing.printReceipt(req.user!.id, id, true);
    });

    app.post('/shifts/:id/print', auth, async (req) => ctx.printing.printShiftReport(req.user!.id, idParam.parse(req.params).id));
    app.post('/print/test', { preHandler: requireRole('OWNER') }, async (req) => ctx.printing.printTest(req.user!.id));
    app.get('/print/jobs', auth, async (req) => ctx.printing.listJobs(listSchema.parse(req.query).limit));
  };
}
```

Pemasangan:
- `context.ts`: `printing: PrintService;`.
- `app.ts`: `BuildAppDeps` tambah `printerFactory?: PrinterFactory;`; setelah `ctx.checkout = …` tambah `ctx.printing = new PrintService(ctx, deps.printerFactory ?? defaultPrinterFactory);`; daftarkan `printingRoutes(ctx)`.
- `checkout.service.ts`: ganti komentar `// (Task 9) cetak struk setelah commit` dengan:
```ts
    this.ctx.printing.later(() => this.ctx.printing.printReceipt(user.id, billId));
```
  Pemanggilan ini hanya terjadi pada checkout yang benar-benar baru (bukan jalur `prior`/idempotent), sehingga request kembar tidak mencetak dua kali.
- `shifts.service.ts` `close()`: setelah `this.ctx.bus.emit('shift.changed');` tambah:
```ts
    this.ctx.printing.later(() => this.ctx.printing.printShiftReport(user.id, closed.id));
```
- `app.ts` hook `onClose`: baris pertama `await ctx.printing.idle();` (sebelum `ctx.scheduler.stop()`), agar test yang menutup app tidak meninggalkan tugas cetak yang menulis ke DB setelah di-reset.
- `test/helpers.ts` `makeApp`: opsi `printerFactory?: PrinterFactory` diteruskan ke `buildApp`.

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/server test && pnpm --filter @funplay/server typecheck`
Expected: PASS. Output test bersih (tidak ada "tugas cetak gagal" di jalur normal).

- [ ] **Step 7: Commit**

```bash
git add apps/server
git commit -m "feat(server): print queue with simulator, USB and LAN ESC/POS drivers"
```

---
### Task 10: Web — event realtime, status shift, halaman Shift

**Files:**
- Modify: `apps/web/src/lib/socket.ts`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`
- Create: `apps/web/src/lib/events.ts`, `apps/web/src/hooks/useShift.ts`
- Create: `apps/web/src/features/shift/OpenShiftDialog.tsx`, `apps/web/src/features/shift/ShiftChip.tsx`, `apps/web/src/features/shift/ShiftPage.tsx`
- Modify: `apps/web/src/features/layout/AppShell.tsx`, `apps/web/src/App.tsx`, `apps/web/src/features/board/BoardPage.tsx`
- Test: `apps/web/src/lib/events.test.ts`, `apps/web/src/features/shift/ShiftPage.test.tsx`

**Interfaces:**
- Consumes: route shift (Task 5); `ShiftSummary`, `ShiftView`, `PrintJobView`, `PAYMENT_METHODS`, `PAYMENT_METHOD_LABEL`, `formatReceiptDate`, `localHHMM` (shared).
- Produces:
  - `RealtimeEvent = { type: 'bill'; id } | { type: 'shift' } | { type: 'printJob'; job: PrintJobView } | { type: 'resync' }`; `connectBoard(onAlert, onUnauthorized, onEvent?)`.
  - `handleRealtime(qc, e)` — invalidate query key: `['bill', id]` + `['bills']`; `['shift']`; `['printJobs']` (+ toast bila job FAILED); `resync` → semuanya.
  - `parseRupiah(s: string): number` (digit saja; kosong → 0) di `lib/format.ts`.
  - `SHIFT_KEY = ['shift', 'current']`, `useCurrentShift()` (data: `ShiftSummary | null`), `useHasShift(): boolean`, `useOpenShift()`.
  - `useOpenShiftDialog` (zustand: `open`, `show()`, `hide()`), komponen `OpenShiftDialog` (dipasang sekali di AppShell), `ShiftChip`, `NoShiftBanner`, `ShiftPage` (route `/shift`).
  - Label UI (dipakai E2E): tombol header **"Buka shift"**; dialog **"Buka shift"** dengan input berlabel **"Kas awal"** dan tombol **"Buka"**; banner tombol **"Buka shift sekarang"**; halaman Shift: input **"Kas fisik"**, input **"Catatan"**, tombol **"Tutup shift"**, selisih `data-testid="shift-difference"`.

- [ ] **Step 1: Tulis test yang gagal**

`apps/web/src/lib/events.test.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { handleRealtime } from './events';
import { useToasts } from '../stores/toast';

describe('handleRealtime', () => {
  it('bill → invalidate bill & daftar bill; shift → shift; printJob gagal → toast', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    handleRealtime(qc, { type: 'bill', id: 'b1' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['bill', 'b1'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['bills'] });
    handleRealtime(qc, { type: 'shift' });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['shift'] });
    handleRealtime(qc, { type: 'printJob', job: { id: 'j', kind: 'RECEIPT', status: 'FAILED', error: 'Printer LAN gagal', previewText: '', billId: 'b1', shiftId: null, createdAt: '' } });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['printJobs'] });
    expect(useToasts.getState().toasts.at(-1)).toMatchObject({ level: 'danger', message: 'Cetak gagal: Printer LAN gagal' });
  });
});
```

Tambahkan di `apps/web/src/lib/format.test.ts`:
```ts
  it('parseRupiah hanya mengambil digit', () => {
    expect(parseRupiah('150.000')).toBe(150000);
    expect(parseRupiah('Rp 20.000')).toBe(20000);
    expect(parseRupiah('')).toBe(0);
  });
```
(tambahkan `parseRupiah` ke import).

`apps/web/src/features/shift/ShiftPage.test.tsx`:
```tsx
import { DEFAULT_TRANSACTION_SETTINGS, type ShiftSummary } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { ShiftPage } from './ShiftPage';

const summary: ShiftSummary = {
  shift: { id: 's1', openedAt: '2026-10-01T01:00:00.000Z', openedByName: 'Andi', openingCash: 100000, closedAt: null, closedByName: null, countedCash: null, expectedCash: null, note: null },
  sales: { CASH: 56000, QRIS: 26000, CARD: 0, TRANSFER: 0 },
  voids: { CASH: 0, QRIS: 0, CARD: 0, TRANSFER: 0 },
  billCount: 2,
  voidCount: 0,
  expectedCash: 156000,
};

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('menampilkan kas seharusnya, selisih, dan menutup shift', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/shifts/current') return json({ summary });
    if (url === '/api/shifts') return json([]);
    if (url === '/api/shifts/current/close' && init?.method === 'POST') return json({ summary: { ...summary, shift: { ...summary.shift, closedAt: '2026-10-01T09:00:00.000Z' } } });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ShiftPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Rp 156.000')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Kas fisik'), '150000');
  expect(screen.getByTestId('shift-difference')).toHaveTextContent('-Rp 6.000');
  await userEvent.click(screen.getByRole('button', { name: 'Tutup shift' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/shifts/current/close');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ countedCash: 150000 });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- events ShiftPage format`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Realtime & helper**

`apps/web/src/lib/format.ts` — tambahkan:
```ts
/** Ambil angka dari input uang ("150.000", "Rp 20.000"); kosong → 0. */
export function parseRupiah(s: string): number {
  const digits = s.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}
```

`apps/web/src/lib/socket.ts` — tambah tipe dan parameter ketiga:
```ts
export type RealtimeEvent =
  | { type: 'bill'; id: string }
  | { type: 'shift' }
  | { type: 'printJob'; job: PrintJobView }
  | { type: 'resync' };

export function connectBoard(onAlert: (a: AlertEvent) => void, onUnauthorized: () => void, onEvent: (e: RealtimeEvent) => void = () => {}): () => void {
```
Ubah handler `connect` menjadi `socket.on('connect', () => { store().setConnected(true); onEvent({ type: 'resync' }); });` dan sebelum `return () => {` tambahkan:
```ts
  socket.on('bill', (p: { id: string }) => onEvent({ type: 'bill', id: p.id }));
  socket.on('shift', () => onEvent({ type: 'shift' }));
  socket.on('printJob', (job: PrintJobView) => onEvent({ type: 'printJob', job }));
```
(import `PrintJobView` dari `@funplay/shared`).

`apps/web/src/lib/events.ts`:
```ts
import type { QueryClient } from '@tanstack/react-query';
import { toast } from '../stores/toast';
import type { RealtimeEvent } from './socket';

export function handleRealtime(qc: QueryClient, e: RealtimeEvent): void {
  const inv = (...key: string[]) => void qc.invalidateQueries({ queryKey: key });
  switch (e.type) {
    case 'bill':
      inv('bill', e.id);
      inv('bills');
      break;
    case 'shift':
      inv('shift');
      break;
    case 'printJob':
      inv('printJobs');
      if (e.job.status === 'FAILED') toast.error(`Cetak gagal: ${e.job.error ?? 'printer tidak merespons'}`);
      break;
    case 'resync':
      for (const k of ['bills', 'bill', 'shift', 'printJobs']) inv(k);
      break;
  }
}
```

`apps/web/src/hooks/useShift.ts`:
```ts
import type { ShiftSummary } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { showError, toast } from '../stores/toast';

export const SHIFT_KEY = ['shift', 'current'] as const;

export function useCurrentShift() {
  return useQuery({ queryKey: SHIFT_KEY, queryFn: () => api<{ summary: ShiftSummary | null }>('GET', '/shifts/current').then((r) => r.summary) });
}

export function useHasShift(): boolean {
  return !!useCurrentShift().data;
}

export function useOpenShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (openingCash: number) => api<{ summary: ShiftSummary }>('POST', '/shifts', { openingCash }),
    onSuccess: (r) => {
      qc.setQueryData(SHIFT_KEY, r.summary);
      toast.success('Shift dibuka');
    },
    onError: showError,
  });
}
```

- [ ] **Step 4: Komponen shift**

`apps/web/src/features/shift/OpenShiftDialog.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { create } from 'zustand';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useOpenShift } from '../../hooks/useShift';
import { formatRupiah, parseRupiah } from '../../lib/format';

export const useOpenShiftDialog = create<{ open: boolean; show(): void; hide(): void }>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));

export function OpenShiftDialog() {
  const { open, hide } = useOpenShiftDialog();
  const [cash, setCash] = useState('');
  const openShift = useOpenShift();
  useEffect(() => {
    if (open) setCash('');
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await openShift.mutateAsync(parseRupiah(cash));
      hide();
    } catch {
      // ditampilkan oleh hook
    }
  };

  return (
    <Modal open={open} onOpenChange={(o) => !o && hide()} title="Buka shift" width="max-w-sm">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="text-sm font-semibold">
          Kas awal
          <Input className="mt-1" inputMode="numeric" autoFocus placeholder="0" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, ''))} />
        </label>
        <p className="text-sm text-muted">{formatRupiah(parseRupiah(cash))}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={hide}>Batal</Button>
          <Button type="submit" disabled={openShift.isPending}>Buka</Button>
        </div>
      </form>
    </Modal>
  );
}
```

`apps/web/src/features/shift/ShiftChip.tsx`:
```tsx
import { localHHMM } from '@funplay/shared';
import { NavLink } from 'react-router';
import { Button } from '../../components/ui/button';
import { useCurrentShift } from '../../hooks/useShift';
import { useBoard } from '../../stores/board';
import { useOpenShiftDialog } from './OpenShiftDialog';

export function ShiftChip() {
  const q = useCurrentShift();
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const show = useOpenShiftDialog((s) => s.show);
  if (q.isLoading) return null;
  if (!q.data) return <Button size="sm" variant="warning" onClick={show}>Buka shift</Button>;
  return (
    <NavLink to="/shift" className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
      Shift: {q.data.shift.openedByName} · sejak {localHHMM(new Date(q.data.shift.openedAt), offset)}
    </NavLink>
  );
}

export function NoShiftBanner() {
  const q = useCurrentShift();
  const show = useOpenShiftDialog((s) => s.show);
  if (q.isLoading || q.data) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-900">
      Buka shift untuk mulai transaksi.
      <Button size="sm" variant="primary" onClick={show}>Buka shift sekarang</Button>
    </div>
  );
}
```

`apps/web/src/features/shift/ShiftPage.tsx`:
```tsx
import { formatReceiptDate, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type ShiftSummary, type ShiftView } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SHIFT_KEY, useCurrentShift } from '../../hooks/useShift';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRupiah, parseRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { showError, toast } from '../../stores/toast';
import { useOpenShiftDialog } from './OpenShiftDialog';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between py-1 text-sm', strong && 'border-t border-line pt-2 text-base font-extrabold text-primary')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CurrentShift({ s }: { s: ShiftSummary }) {
  const qc = useQueryClient();
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const close = useMutation({
    mutationFn: () => api<{ summary: ShiftSummary }>('POST', '/shifts/current/close', { countedCash: parseRupiah(counted), note: note.trim() || undefined }),
    onSuccess: () => {
      qc.setQueryData(SHIFT_KEY, null);
      void qc.invalidateQueries({ queryKey: ['shift'] });
      toast.success('Shift ditutup');
    },
    onError: showError,
  });
  const diff = counted === '' ? null : parseRupiah(counted) - s.expectedCash;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-extrabold">Shift berjalan · {s.shift.openedByName}</h2>
        <Row label="Kas awal" value={formatRupiah(s.shift.openingCash)} />
        {PAYMENT_METHODS.map((m) => (
          <Row key={m} label={`Penjualan ${PAYMENT_METHOD_LABEL[m]}`} value={formatRupiah(s.sales[m])} />
        ))}
        {PAYMENT_METHODS.filter((m) => s.voids[m] > 0).map((m) => (
          <Row key={m} label={`Void ${PAYMENT_METHOD_LABEL[m]}`} value={`-${formatRupiah(s.voids[m])}`} />
        ))}
        <Row label="Jumlah bill" value={String(s.billCount)} />
        <Row label="Kas seharusnya" value={formatRupiah(s.expectedCash)} strong />
      </section>
      <section className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="text-lg font-extrabold">Tutup shift</h2>
        <label className="text-sm font-semibold">
          Kas fisik
          <Input className="mt-1" inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value.replace(/\D/g, ''))} />
        </label>
        <div
          data-testid="shift-difference"
          className={cn(
            'rounded-xl px-3 py-2 text-sm font-bold',
            diff === null ? 'bg-bg text-muted' : diff === 0 ? 'bg-emerald-100 text-emerald-800' : Math.abs(diff) < 50000 ? 'bg-amber-100 text-amber-900' : 'bg-rose-100 text-rose-800',
          )}
        >
          Selisih: {diff === null ? '—' : formatRupiah(diff)}
        </div>
        <label className="text-sm font-semibold">
          Catatan
          <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
        <Button size="lg" variant="danger" disabled={counted === '' || close.isPending} onClick={() => close.mutate()}>Tutup shift</Button>
      </section>
    </div>
  );
}

export function ShiftPage() {
  const current = useCurrentShift();
  const show = useOpenShiftDialog((s) => s.show);
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const history = useQuery({ queryKey: ['shift', 'list'], queryFn: () => api<ShiftView[]>('GET', '/shifts') });
  const print = useMutation({
    mutationFn: (id: string) => api('POST', `/shifts/${id}/print`, {}),
    onSuccess: () => toast.success('Rekap dikirim ke printer'),
    onError: showError,
  });
  const when = (iso: string | null) => (iso ? formatReceiptDate(new Date(iso), offset) : '—');

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      {current.data ? (
        <CurrentShift s={current.data} />
      ) : (
        <div className="flex items-center justify-between rounded-2xl bg-surface p-5 shadow-sm">
          <span className="font-semibold">Belum ada shift terbuka.</span>
          <Button onClick={show}>Buka shift sekarang</Button>
        </div>
      )}
      <section className="rounded-2xl bg-surface p-5 shadow-sm">
        <h2 className="mb-3 text-lg font-extrabold">Riwayat shift</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th>Buka</th><th>Tutup</th><th>Kasir</th><th className="text-right">Seharusnya</th><th className="text-right">Dihitung</th><th className="text-right">Selisih</th><th /></tr>
          </thead>
          <tbody>
            {(history.data ?? []).map((h) => (
              <tr key={h.id} className="border-t border-line">
                <td className="py-2">{when(h.openedAt)}</td>
                <td>{when(h.closedAt)}</td>
                <td>{h.openedByName}</td>
                <td className="text-right tabular-nums">{h.expectedCash === null ? '—' : formatRupiah(h.expectedCash)}</td>
                <td className="text-right tabular-nums">{h.countedCash === null ? '—' : formatRupiah(h.countedCash)}</td>
                <td className="text-right tabular-nums">{h.countedCash === null || h.expectedCash === null ? '—' : formatRupiah(h.countedCash - h.expectedCash)}</td>
                <td className="text-right">{h.closedAt && <Button size="sm" variant="ghost" onClick={() => print.mutate(h.id)}>Cetak</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Pasang di AppShell, App, BoardPage**

`AppShell.tsx`:
- import `ShiftChip`, `OpenShiftDialog`, `handleRealtime`, ikon `Wallet` (lucide-react).
- `connectBoard(...)` mendapat argumen ketiga `(e) => handleRealtime(qc, e)`.
- `items` ditambah `{ to: '/shift', label: 'Shift', icon: Wallet, show: true }` (setelah Meja).
- Di header, sebelum chip nama user: `<ShiftChip />`.
- Setelah `</main>`… di dalam root `div`, tambahkan `<OpenShiftDialog />`.

`App.tsx`: tambahkan route `<Route path="shift" element={<ShiftPage />} />` di dalam layout.

`BoardPage.tsx`: tepat setelah blok alert koneksi terputus, tambahkan `<NoShiftBanner />` (import dari `../shift/ShiftChip`).

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): realtime bill/shift events, shift chip, open/close shift page"
```

---

### Task 11: Web — pengaturan Pajak & Service, Struk & Printer, halaman Produk

**Files:**
- Create: `apps/web/src/features/settings/useSettingsDraft.ts`, `apps/web/src/features/settings/TransactionSettings.tsx`, `apps/web/src/features/settings/PrinterSettings.tsx`, `apps/web/src/features/products/ProductsPage.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`, `apps/web/src/features/settings/resources.ts`, `apps/web/src/App.tsx`, `apps/web/src/features/layout/AppShell.tsx`
- Test: `apps/web/src/features/settings/TransactionSettings.test.tsx`

**Interfaces:**
- Consumes: `PUT /api/settings`, `POST /api/print/test`, route katalog (Task 4, 6, 9); `CrudResource`/`ResourceConfig` (M1); `SCOPES`, `PRINTER_DRIVERS`, `PublicSettings`.
- Produces: `useSettingsDraft()` → `{ v, setV, save }`; tab pengaturan **"Pajak & Service"** dan **"Struk & Printer"**; `RESOURCES.categories`, `RESOURCES.products` (path `/categories`, `/products` — query key CRUD = `['/categories']`, `['/products']`, dipakai juga oleh dialog Pesan Task 13); route `/products` (SUPERVISOR, OWNER); menu sidebar **"Produk"**.

- [ ] **Step 1: Tulis test yang gagal**

`apps/web/src/features/settings/TransactionSettings.test.tsx`:
```tsx
import { DEFAULT_TRANSACTION_SETTINGS } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PrinterSettings } from './PrinterSettings';
import { TransactionSettings } from './TransactionSettings';

const settings = { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS };

function mockFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/settings' && (!init || init.method === 'GET')) return json(settings);
    if (url === '/api/settings' && init?.method === 'PUT') return json({ ...settings, ...JSON.parse(String(init.body)) });
    if (url === '/api/print/test') return json({ id: 'j1', kind: 'TEST', status: 'PENDING', error: null, previewText: '', billId: null, shiftId: null, createdAt: '' });
    return new Response('{}', { status: 404 });
  });
}
const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
afterEach(() => vi.unstubAllGlobals());

it('menyimpan pajak & cakupan', async () => {
  const f = mockFetch();
  vi.stubGlobal('fetch', f);
  wrap(<TransactionSettings />);
  const tax = await screen.findByLabelText('Pajak (%)');
  await userEvent.clear(tax);
  await userEvent.type(tax, '11');
  await userEvent.selectOptions(screen.getByLabelText('Cakupan pajak'), 'FNB');
  await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
  await waitFor(() => {
    const call = f.mock.calls.find(([u, i]) => u === '/api/settings' && i?.method === 'PUT');
    expect(JSON.parse(String(call![1]!.body))).toMatchObject({ taxPct: 11, taxScope: 'FNB', servicePct: 0, discountApprovalPct: 10 });
  });
});

it('printer LAN menampilkan host & port; tes cetak memanggil API', async () => {
  const f = mockFetch();
  vi.stubGlobal('fetch', f);
  wrap(<PrinterSettings />);
  await userEvent.selectOptions(await screen.findByLabelText('Driver printer'), 'LAN');
  expect(screen.getByLabelText('Host / IP')).toBeInTheDocument();
  expect(screen.getByLabelText('Port')).toHaveValue('9100');
  await userEvent.click(screen.getByRole('button', { name: 'Tes cetak' }));
  await waitFor(() => expect(f.mock.calls.some(([u]) => u === '/api/print/test')).toBe(true));
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- TransactionSettings`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Implementasi**

`apps/web/src/features/settings/useSettingsDraft.ts`:
```ts
import type { PublicSettings } from '@funplay/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { showError, toast } from '../../stores/toast';

/** Salinan pengaturan yang bisa diedit + simpan sebagian (PUT /settings). */
export function useSettingsDraft() {
  const q = useQuery({ queryKey: ['/settings'], queryFn: () => api<PublicSettings>('GET', '/settings') });
  const [v, setV] = useState<PublicSettings | null>(null);
  useEffect(() => {
    if (q.data) setV(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: Partial<PublicSettings>) => api<PublicSettings>('PUT', '/settings', body),
    onSuccess: () => toast.success('Pengaturan disimpan'),
    onError: showError,
  });
  return { v, setV, save };
}
```

`apps/web/src/features/settings/TransactionSettings.tsx`:
```tsx
import type { PublicSettings, Scope } from '@funplay/shared';
import type { FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { useSettingsDraft } from './useSettingsDraft';

const SCOPE_LABEL: Record<Scope, string> = { NONE: 'Nonaktif', BILLING: 'Biaya waktu saja', FNB: 'FnB & layanan saja', ALL: 'Semua' };
const select = 'mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm';

export function TransactionSettings() {
  const { v, setV, save } = useSettingsDraft();
  if (!v) return null;
  const num = (k: keyof PublicSettings) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: Number(e.target.value) });
  const scope = (k: 'taxScope' | 'serviceScope') => (
    <select id={k} className={select} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value as Scope })}>
      {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
    </select>
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ taxPct: v.taxPct, taxScope: v.taxScope, servicePct: v.servicePct, serviceScope: v.serviceScope, discountApprovalPct: v.discountApprovalPct });
  };

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4 rounded-2xl bg-surface p-5 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">Pajak (%)<Input className="mt-1" type="number" min={0} max={100} value={v.taxPct} onChange={num('taxPct')} /></label>
        <label className="text-sm font-semibold" htmlFor="taxScope">Cakupan pajak{scope('taxScope')}</label>
        <label className="text-sm font-semibold">Service (%)<Input className="mt-1" type="number" min={0} max={100} value={v.servicePct} onChange={num('servicePct')} /></label>
        <label className="text-sm font-semibold" htmlFor="serviceScope">Cakupan service{scope('serviceScope')}</label>
      </div>
      <label className="text-sm font-semibold">Batas diskon tanpa PIN supervisor (%)<Input className="mt-1" type="number" min={0} max={100} value={v.discountApprovalPct} onChange={num('discountApprovalPct')} /></label>
      <p className="text-xs text-muted">Urutan hitung: subtotal → diskon → service → pajak.</p>
      <Button type="submit" disabled={save.isPending} className="justify-self-start">Simpan</Button>
    </form>
  );
}
```

`apps/web/src/features/settings/PrinterSettings.tsx`:
```tsx
import type { PrinterDriver } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { showError, toast } from '../../stores/toast';
import { useSettingsDraft } from './useSettingsDraft';

const DRIVER_LABEL: Record<PrinterDriver, string> = { SIMULATOR: 'Simulator (pratinjau di layar)', USB: 'USB di server', LAN: 'LAN (TCP 9100)' };
const area = 'mt-1 min-h-20 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm';

export function PrinterSettings() {
  const { v, setV, save } = useSettingsDraft();
  const test = useMutation({ mutationFn: () => api('POST', '/print/test', {}), onSuccess: () => toast.success('Tes cetak dikirim'), onError: showError });
  if (!v) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      receiptHeader: v.receiptHeader, receiptFooter: v.receiptFooter,
      printerDriver: v.printerDriver, printerDevicePath: v.printerDevicePath, printerHost: v.printerHost, printerPort: v.printerPort,
    });
  };

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4 rounded-2xl bg-surface p-5 shadow-sm">
      <label className="text-sm font-semibold">Header struk<textarea className={area} value={v.receiptHeader} onChange={(e) => setV({ ...v, receiptHeader: e.target.value })} /></label>
      <label className="text-sm font-semibold">Footer struk<textarea className={area} value={v.receiptFooter} onChange={(e) => setV({ ...v, receiptFooter: e.target.value })} /></label>
      <label className="text-sm font-semibold">
        Driver printer
        <select className="mt-1 h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm" value={v.printerDriver} onChange={(e) => setV({ ...v, printerDriver: e.target.value as PrinterDriver })}>
          {(Object.keys(DRIVER_LABEL) as PrinterDriver[]).map((d) => <option key={d} value={d}>{DRIVER_LABEL[d]}</option>)}
        </select>
      </label>
      {v.printerDriver === 'USB' && (
        <label className="text-sm font-semibold">Path device<Input className="mt-1" value={v.printerDevicePath} onChange={(e) => setV({ ...v, printerDevicePath: e.target.value })} /></label>
      )}
      {v.printerDriver === 'LAN' && (
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <label className="text-sm font-semibold">Host / IP<Input className="mt-1" value={v.printerHost} onChange={(e) => setV({ ...v, printerHost: e.target.value })} /></label>
          <label className="text-sm font-semibold">Port<Input className="mt-1" inputMode="numeric" value={String(v.printerPort)} onChange={(e) => setV({ ...v, printerPort: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending}>Simpan</Button>
        <Button variant="soft" onClick={() => test.mutate()} disabled={test.isPending}>Tes cetak</Button>
      </div>
      <p className="text-xs text-muted">Simpan dulu sebelum tes cetak bila driver diubah.</p>
    </form>
  );
}
```

`resources.ts` — tambahkan ke `RESOURCES`:
```ts
  categories: {
    title: 'Kategori',
    path: '/categories',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'color', label: 'Warna (#RRGGBB)', type: 'text', defaultValue: '#7C3AED' },
      { name: 'sortOrder', label: 'Urutan', type: 'number', defaultValue: '0' },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
  products: {
    title: 'Produk & Layanan',
    path: '/products',
    canDelete: true,
    fields: [
      { name: 'name', label: 'Nama', type: 'text', required: true },
      { name: 'categoryId', label: 'Kategori', type: 'select', required: true, optionsFrom: { path: '/categories', label: (r: { name: string }) => r.name } },
      { name: 'kind', label: 'Jenis', type: 'select', defaultValue: 'STOCK', options: [{ value: 'STOCK', label: 'Stok (FnB)' }, { value: 'SERVICE', label: 'Layanan (tanpa stok)' }] },
      { name: 'price', label: 'Harga', type: 'money', required: true },
      { name: 'stockQty', label: 'Stok', type: 'number', defaultValue: '0' },
      { name: 'active', label: 'Aktif', type: 'checkbox' },
    ],
  },
```

`apps/web/src/features/products/ProductsPage.tsx`:
```tsx
import { useState } from 'react';
import { cn } from '../../lib/cn';
import { CrudResource } from '../settings/CrudResource';
import { RESOURCES } from '../settings/resources';

const TABS = [
  { key: 'products', label: 'Produk & Layanan' },
  { key: 'categories', label: 'Kategori' },
] as const;

export function ProductsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('products');
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto">
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn('rounded-full px-4 py-1.5 text-sm font-semibold', tab === t.key ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
            {t.label}
          </button>
        ))}
      </div>
      <CrudResource key={tab} config={RESOURCES[tab]} />
    </div>
  );
}
```

`SettingsPage.tsx`: `TABS` ditambah `{ key: 'transaction', label: 'Pajak & Service' }` dan `{ key: 'printer', label: 'Struk & Printer' }` setelah `general`; render: `tab === 'general' ? <GeneralSettings /> : tab === 'transaction' ? <TransactionSettings /> : tab === 'printer' ? <PrinterSettings /> : <CrudResource key={tab} config={RESOURCES[tab]} />`.

`App.tsx`: route `products` dengan `<RequireRole roles={['SUPERVISOR', 'OWNER']}><ProductsPage /></RequireRole>`.

`AppShell.tsx`: `items` ditambah `{ to: '/products', label: 'Produk', icon: Coffee, show: me.role !== 'KASIR' }` (sebelum Pengaturan).

- [ ] **Step 4: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat(web): tax/service and printer settings, products page"
```

---

### Task 12: Web — dialog Checkout (rincian, diskon, gabung, split payment)

**Files:**
- Create: `apps/web/src/stores/checkout.ts`, `apps/web/src/hooks/useBill.ts`
- Create: `apps/web/src/features/checkout/CheckoutDialog.tsx`, `apps/web/src/features/checkout/PaymentComposer.tsx`, `apps/web/src/features/checkout/DiscountEditor.tsx`, `apps/web/src/features/checkout/MergeDialog.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/hooks/useBill.test.ts`, `apps/web/src/features/checkout/CheckoutDialog.test.tsx`

**Interfaces:**
- Consumes: route bill & checkout (Task 7, 8); `computeBillTotals`, `lineScope`, `needsDiscountApproval`, `cashPayment`, `computeSessionCharge`, `PAYMENT_METHOD_LABEL`, `BillView`, `CheckoutResult`, `PaymentInput`, `Discount` (shared); `approvalPin` (stores/pin), `newId`, `useNow`, `useBoard`, `useMe`.
- Produces:
  - `useCheckout` (zustand: `billId: string | null`, `open(id)`, `close()`); `CheckoutHost` (dipasang di `App.tsx`, di samping `PinPrompt`).
  - `billKey(id)`, `useBill(id)`, `useBillAction(billId)` (mutasi generik `{ method, path, body }` → `BillView`, set cache `['bill', id]`, invalidate `['bills']`), `computeBillPreview(bill, settings, tariffs, now)` → `{ totals, liveTime }`, `useBillPreview(bill, now)`.
  - Label UI (E2E): judul **"Bayar · <label>"**; tombol metode **"Tunai" "QRIS" "Kartu" "Transfer"** (`aria-pressed`); input **"Nominal"**; tombol **"Uang pas"**, **"Tambah pembayaran"**, **"Diskon bill"**, **"Gabung bill lain"**, **"Bayar"**; total `data-testid="checkout-total"`.

- [ ] **Step 1: Tulis test yang gagal**

`apps/web/src/hooks/useBill.test.ts`:
```ts
import { DEFAULT_TRANSACTION_SETTINGS, type BillView, type PublicSettings } from '@funplay/shared';
import { expect, it } from 'vitest';
import { computeBillPreview } from './useBill';

const settings: PublicSettings = { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS };

it('pratinjau menjumlahkan baris tersimpan + biaya waktu sesi yang masih berjalan', () => {
  const bill: BillView = {
    id: 'b1', number: 'FP-1', label: 'Meja 1', status: 'OPEN', createdAt: '', createdByName: 'k', billDiscount: null,
    lines: [{ id: 'l1', type: 'PRODUCT', productId: 'p', sessionId: null, name: 'Es Teh', unitPrice: 8000, qty: 2, discount: null, breakdown: null }],
    activeSessions: [{
      id: 's1', billId: 'b1', unitName: 'Meja 1', mode: 'OPEN', status: 'RUNNING', startedAt: '2026-10-01T03:00:00.000Z', plannedEndAt: null, endedAt: null,
      packageName: null, packageDurationMin: null, packagePrice: null,
      segments: [{ unitId: 'u1', unitTypeId: 'reg', startedAt: '2026-10-01T03:00:00.000Z', endedAt: null }], pauses: [],
    }],
    payments: [], stored: null, paidAt: null, paidByName: null, shiftId: null, mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null,
  };
  const tariffs = [{ id: 't', name: 'Reguler Siang', unitTypeId: 'reg', daysMask: 127, startMin: 480, endMin: 1080, pricePerHour: 40000, priority: 0 }];
  const p = computeBillPreview(bill, settings, tariffs, new Date('2026-10-01T03:30:00Z'));
  expect(p.liveTime[0]!.charge!.total).toBe(40000); // minimum 60 menit
  expect(p.totals.grandTotal).toBe(56000);
});
```

`apps/web/src/features/checkout/CheckoutDialog.test.tsx`:
```tsx
import { DEFAULT_TRANSACTION_SETTINGS, type BillView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBoard } from '../../stores/board';
import { CheckoutDialog } from './CheckoutDialog';

const bill: BillView = {
  id: 'b1', number: 'FP-20261001-0001', label: 'Meja 1', status: 'OPEN', createdAt: '2026-10-01T03:00:00.000Z', createdByName: 'Kasir', billDiscount: null,
  lines: [
    { id: 'l1', type: 'TIME', productId: null, sessionId: 's1', name: 'Meja 1 - Open billing', unitPrice: 40000, qty: 1, discount: null,
      breakdown: [{ kind: 'TARIFF', label: 'Reguler Siang', tariffId: 't', unitTypeId: 'reg', pricePerHour: 40000, minutes: 60, amount: 40000 }] },
    { id: 'l2', type: 'PRODUCT', productId: 'p1', sessionId: null, name: 'Es Teh', unitPrice: 8000, qty: 2, discount: null, breakdown: null },
  ],
  activeSessions: [], payments: [], stored: null, paidAt: null, paidByName: null, shiftId: null, mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null,
};

function setup(b: BillView = bill) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/bills/b1') return json(b);
    if (url === '/api/bills/b1/checkout' && init?.method === 'POST') return json({ bill: { ...b, status: 'PAID' }, change: 44000 });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CheckoutDialog billId="b1" onClose={onClose} />
    </QueryClientProvider>,
  );
  return { fetchMock, onClose };
}

const body = (f: ReturnType<typeof vi.fn>) => JSON.parse(String(f.mock.calls.find(([u]) => u === '/api/bills/b1/checkout')![1]!.body));

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('tunai dengan kembalian lalu bayar', async () => {
  const { fetchMock, onClose } = setup();
  expect(await screen.findByTestId('checkout-total')).toHaveTextContent('Rp 56.000');
  await userEvent.type(screen.getByLabelText('Nominal'), '100000');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah pembayaran' }));
  expect(screen.getByTestId('checkout-change')).toHaveTextContent('Rp 44.000');
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const sent = body(fetchMock);
  expect(sent).toMatchObject({ expectedGrandTotal: 56000, payments: [{ method: 'CASH', amount: 56000, received: 100000 }] });
  expect(sent.idempotencyKey.length).toBeGreaterThanOrEqual(8);
});

it('split QRIS + uang pas tunai; Bayar aktif hanya saat sisa 0', async () => {
  const { fetchMock } = setup();
  await screen.findByTestId('checkout-total');
  await userEvent.click(screen.getByRole('button', { name: 'QRIS' }));
  await userEvent.type(screen.getByLabelText('Nominal'), '30000');
  await userEvent.click(screen.getByRole('button', { name: 'Tambah pembayaran' }));
  expect(screen.getByRole('button', { name: 'Bayar' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Tunai' }));
  await userEvent.click(screen.getByRole('button', { name: 'Uang pas' }));
  await userEvent.click(screen.getByRole('button', { name: 'Bayar' }));
  await waitFor(() =>
    expect(body(fetchMock).payments).toEqual([
      { method: 'QRIS', amount: 30000, reference: null },
      { method: 'CASH', amount: 26000, received: 26000 },
    ]),
  );
});

it('sesi masih berjalan → Bayar nonaktif dengan pesan', async () => {
  setup({ ...bill, activeSessions: [{ id: 's9', billId: 'b1', unitName: 'Meja 2', mode: 'OPEN', status: 'RUNNING', startedAt: '2026-10-01T03:00:00.000Z', plannedEndAt: null, endedAt: null, packageName: null, packageDurationMin: null, packagePrice: null, segments: [], pauses: [] }] });
  expect(await screen.findByText('Hentikan sesi meja terlebih dahulu')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Bayar' })).toBeDisabled();
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- useBill CheckoutDialog`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: Store & hook bill**

`apps/web/src/stores/checkout.ts`:
```ts
import { create } from 'zustand';

/** Dialog checkout global: tetap terbuka walau panel meja asalnya hilang (meja kosong setelah stop). */
export const useCheckout = create<{ billId: string | null; open(id: string): void; close(): void }>((set) => ({
  billId: null,
  open: (id) => set({ billId: id }),
  close: () => set({ billId: null }),
}));
```

`apps/web/src/hooks/useBill.ts`:
```ts
import {
  computeBillTotals, computeSessionCharge, lineScope,
  type BillTotals, type BillView, type PublicSettings, type TariffRule, type TimeCharge, type TotalsLineInput,
} from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useBoard } from '../stores/board';
import { showError } from '../stores/toast';

export const billKey = (id: string) => ['bill', id] as const;

export function useBill(id: string | null) {
  return useQuery({ queryKey: billKey(id ?? ''), queryFn: () => api<BillView>('GET', `/bills/${id}`), enabled: !!id });
}

export function useBillAction(billId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ method, path, body }: { method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown }) => api<BillView>(method, path, body ?? {}),
    onSuccess: (b) => {
      qc.setQueryData(billKey(b.id), b);
      if (b.id !== billId) void qc.invalidateQueries({ queryKey: billKey(billId) });
      void qc.invalidateQueries({ queryKey: ['bills'] });
    },
    onError: showError,
  });
}

export interface BillPreview {
  totals: BillTotals;
  liveTime: { sessionId: string; unitName: string; charge: TimeCharge | null }[];
}

/** Total bill = baris tersimpan + biaya waktu sesi yang masih berjalan (kalkulator yang sama dengan server). */
export function computeBillPreview(bill: BillView, settings: PublicSettings, tariffs: TariffRule[], now: Date): BillPreview {
  const liveTime = bill.activeSessions.map((s) => {
    let charge: TimeCharge | null = null;
    try {
      charge = computeSessionCharge(s, tariffs, settings, now);
    } catch {
      charge = null;
    }
    return { sessionId: s.id, unitName: s.unitName, charge };
  });
  const lines: TotalsLineInput[] = [
    ...bill.lines.map((l) => ({ id: l.id, scope: lineScope(l.type), amount: l.unitPrice * l.qty, discount: l.discount })),
    ...liveTime.map((t) => ({ id: `live-${t.sessionId}`, scope: 'BILLING' as const, amount: t.charge?.total ?? 0, discount: null })),
  ];
  return { totals: computeBillTotals(lines, bill.billDiscount, settings), liveTime };
}

export function useBillPreview(bill: BillView | undefined, now: Date): BillPreview | null {
  const settings = useBoard((s) => s.settings);
  const tariffs = useBoard((s) => s.tariffs);
  if (!bill || !settings) return null;
  return computeBillPreview(bill, settings, tariffs, now);
}
```

- [ ] **Step 4: Komponen checkout**

`apps/web/src/features/checkout/PaymentComposer.tsx`:
```tsx
import { cashPayment, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type PaymentInput, type PaymentMethod } from '@funplay/shared';
import { X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { cn } from '../../lib/cn';
import { formatRupiah, parseRupiah } from '../../lib/format';

const QUICK_CASH = [20000, 50000, 100000];

export function PaymentComposer({ remaining, payments, onChange }: { remaining: number; payments: PaymentInput[]; onChange: (p: PaymentInput[]) => void }) {
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');

  const add = (value: number) => {
    if (value <= 0 || remaining <= 0) return;
    const p: PaymentInput = method === 'CASH' ? cashPayment(remaining, value) : { method, amount: Math.min(value, remaining), reference: reference.trim() || null };
    onChange([...payments, p]);
    setAmount('');
    setReference('');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        {PAYMENT_METHODS.map((m) => (
          <button key={m} type="button" aria-pressed={method === m} onClick={() => setMethod(m)}
            className={cn('rounded-xl py-2 text-sm font-bold transition', method === m ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
            {PAYMENT_METHOD_LABEL[m]}
          </button>
        ))}
      </div>
      <label className="text-sm font-semibold">
        Nominal
        <Input className="mt-1 text-lg" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} />
      </label>
      {method !== 'CASH' && (
        <label className="text-sm font-semibold">
          Referensi (opsional)
          <Input className="mt-1" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="soft" disabled={remaining <= 0} onClick={() => add(remaining)}>Uang pas</Button>
        {method === 'CASH' && QUICK_CASH.map((v) => (
          <Button key={v} size="sm" variant="soft" disabled={remaining <= 0} onClick={() => add(v)}>{formatRupiah(v)}</Button>
        ))}
      </div>
      <Button variant="soft" disabled={!amount || remaining <= 0} onClick={() => add(parseRupiah(amount))}>Tambah pembayaran</Button>
      {payments.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl bg-bg p-2 text-sm">
          {payments.map((p, i) => (
            <li key={i} className="flex items-center justify-between">
              <span>{PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
              <span className="flex items-center gap-2 tabular-nums">
                {formatRupiah(p.received ?? p.amount)}
                <button type="button" aria-label={`Hapus pembayaran ${i + 1}`} onClick={() => onChange(payments.filter((_, j) => j !== i))}><X size={14} /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

`apps/web/src/features/checkout/DiscountEditor.tsx`:
```tsx
import type { Discount, DiscountType } from '@funplay/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { cn } from '../../lib/cn';

export function DiscountEditor({ title, initial, onSave, onClose }: { title: string; initial: Discount | null; onSave: (d: Discount | null) => void; onClose: () => void }) {
  const [type, setType] = useState<DiscountType>(initial?.type ?? 'PERCENT');
  const [value, setValue] = useState(initial ? String(initial.value) : '');
  const n = Number(value || 0);
  const invalid = type === 'PERCENT' && n > 100;
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} width="max-w-xs"
      footer={
        <>
          <Button variant="ghost" onClick={() => onSave(null)}>Hapus diskon</Button>
          <Button disabled={invalid} onClick={() => onSave(n > 0 ? { type, value: n } : null)}>Simpan</Button>
        </>
      }>
      <div className="mb-3 grid grid-cols-2 gap-2">
        {(['AMOUNT', 'PERCENT'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}
            className={cn('rounded-lg py-2 text-sm font-bold', type === t ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
            {t === 'AMOUNT' ? 'Rp' : '%'}
          </button>
        ))}
      </div>
      <label className="text-sm font-semibold">
        Nilai diskon
        <Input className="mt-1" inputMode="numeric" autoFocus value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} />
      </label>
      {invalid && <p className="mt-1 text-sm text-rose-600">Diskon persen maksimal 100</p>}
    </Modal>
  );
}
```

`apps/web/src/features/checkout/MergeDialog.tsx`:
```tsx
import type { BillSummary } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../../components/ui/modal';
import { useBillAction } from '../../hooks/useBill';
import { api } from '../../lib/api';
import { formatRupiah } from '../../lib/format';

export function MergeDialog({ targetId, onClose }: { targetId: string; onClose: () => void }) {
  const open = useQuery({ queryKey: ['bills', { status: 'OPEN' }], queryFn: () => api<BillSummary[]>('GET', '/bills?status=OPEN') });
  const action = useBillAction(targetId);
  const others = (open.data ?? []).filter((b) => b.id !== targetId);
  const merge = async (sourceBillId: string) => {
    try {
      await action.mutateAsync({ method: 'POST', path: `/bills/${targetId}/merge`, body: { sourceBillId } });
      onClose();
    } catch {
      // ditampilkan oleh hook
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Gabung bill lain">
      {others.length === 0 && <p className="text-sm text-muted">Tidak ada bill lain yang belum dibayar.</p>}
      <div className="flex flex-col gap-2">
        {others.map((b) => (
          <button key={b.id} type="button" disabled={action.isPending} onClick={() => merge(b.id)}
            className="flex justify-between rounded-xl border-2 border-line px-3 py-2 text-left text-sm font-semibold hover:border-primary">
            <span>{b.label} · {b.number}{b.hasActiveSession ? ' · masih main' : ''}</span>
            <span className="tabular-nums">{formatRupiah(b.total)}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
```

`apps/web/src/features/checkout/CheckoutDialog.tsx`:
```tsx
import { needsDiscountApproval, type BillView, type CheckoutResult, type PaymentInput } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { useNow } from '../../hooks/useNow';
import { billKey, useBill, useBillAction, useBillPreview } from '../../hooks/useBill';
import { api, ApiError } from '../../lib/api';
import { formatMinutes, formatRupiah } from '../../lib/format';
import { newId } from '../../lib/id';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { approvalPin } from '../../stores/pin';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';
import { DiscountEditor } from './DiscountEditor';
import { MergeDialog } from './MergeDialog';
import { PaymentComposer } from './PaymentComposer';

function Row({ label, value, testId, strong }: { label: string; value: string; testId?: string; strong?: boolean }) {
  return (
    <div className={strong ? 'flex justify-between border-t border-line pt-2 text-xl font-extrabold text-primary' : 'flex justify-between text-sm'}>
      <span>{label}</span>
      <span className="tabular-nums" data-testid={testId}>{value}</span>
    </div>
  );
}

export function CheckoutHost() {
  const { billId, close } = useCheckout();
  return billId ? <CheckoutDialog key={billId} billId={billId} onClose={close} /> : null;
}

function blockedReason(b: BillView): string | null {
  if (b.status !== 'OPEN') return 'Bill sudah tidak bisa dibayar';
  if (b.activeSessions.length) return 'Hentikan sesi meja terlebih dahulu';
  if (!b.lines.length) return 'Bill masih kosong';
  return null;
}

export function CheckoutDialog({ billId, onClose }: { billId: string; onClose: () => void }) {
  const me = useMe().data;
  const qc = useQueryClient();
  const bill = useBill(billId);
  const settings = useBoard((s) => s.settings);
  const now = useNow();
  const preview = useBillPreview(bill.data, now);
  const action = useBillAction(billId);
  const [payments, setPayments] = useState<PaymentInput[]>([]);
  const [editing, setEditing] = useState<null | 'bill' | string>(null);
  const [merging, setMerging] = useState(false);
  const key = useRef(newId());

  const pay = useMutation({
    mutationFn: (body: Record<string, unknown>) => api<CheckoutResult>('POST', `/bills/${billId}/checkout`, body),
    onSuccess: (r) => {
      qc.setQueryData(billKey(billId), r.bill);
      void qc.invalidateQueries({ queryKey: ['bills'] });
      toast.success(r.change > 0 ? `Lunas · kembalian ${formatRupiah(r.change)}` : 'Lunas');
      onClose();
    },
    onError: (err) => {
      showError(err);
      if (err instanceof ApiError && err.code === 'TOTAL_CHANGED') {
        setPayments([]);
        key.current = newId();
        void bill.refetch();
      }
    },
  });

  if (!bill.data || !preview || !settings || !me) {
    return <Modal open onOpenChange={(o) => !o && onClose()} title="Bayar"><p className="text-sm text-muted">Memuat…</p></Modal>;
  }
  const b = bill.data;
  const t = preview.totals;
  const paid = payments.reduce((a, p) => a + p.amount, 0);
  const remaining = t.grandTotal - paid;
  const change = payments.reduce((a, p) => a + ((p.received ?? p.amount) - p.amount), 0);
  const blocked = blockedReason(b);

  const saveDiscount = (d: BillView['billDiscount']) => {
    const target = editing;
    setEditing(null);
    setPayments([]);
    if (target === 'bill') action.mutate({ method: 'PUT', path: `/bills/${billId}/discount`, body: { discount: d } });
    else if (target) action.mutate({ method: 'PATCH', path: `/bills/${billId}/items/${target}`, body: { discount: d } });
  };

  const submit = async () => {
    let pin: string | undefined;
    if (needsDiscountApproval(t, settings.discountApprovalPct)) {
      const p = await approvalPin(me.role, 'PIN supervisor untuk diskon');
      if (p === null) return;
      pin = p;
    }
    pay.mutate({ idempotencyKey: key.current, expectedGrandTotal: t.grandTotal, payments, ...(pin ? { approvalPin: pin } : {}) });
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Bayar · ${b.label}`} width="max-w-4xl">
      <div className="grid gap-6 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <p className="text-xs text-muted">{b.number}</p>
          {b.lines.map((l, i) => (
            <div key={l.id} className="rounded-xl bg-bg p-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold">{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</span>
                <span className="tabular-nums">{formatRupiah(l.unitPrice * l.qty)}</span>
              </div>
              {l.breakdown && (
                <details className="text-xs text-muted">
                  <summary>Rincian tarif</summary>
                  {l.breakdown.map((c, j) => <div key={j}>{c.label} · {formatMinutes(c.minutes)} · {formatRupiah(c.amount)}</div>)}
                </details>
              )}
              <div className="flex items-center justify-between text-xs">
                {t.lines[i]!.itemDiscount > 0 ? <span className="text-emerald-700">Diskon -{formatRupiah(t.lines[i]!.itemDiscount)}</span> : <span />}
                <button type="button" className="font-semibold text-primary-ink" aria-label={`Diskon ${l.name}`} onClick={() => setEditing(l.id)}>Diskon</button>
              </div>
            </div>
          ))}
          {preview.liveTime.map((x) => (
            <div key={x.sessionId} className="flex justify-between rounded-xl bg-amber-50 p-2 text-sm text-amber-900">
              <span>{x.unitName} · sedang berjalan</span>
              <span className="tabular-nums">{formatRupiah(x.charge?.total ?? 0)}</span>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="soft" onClick={() => setEditing('bill')}>Diskon bill</Button>
            <Button size="sm" variant="soft" onClick={() => setMerging(true)}>Gabung bill lain</Button>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <Row label="Subtotal" value={formatRupiah(t.subtotal)} />
            {t.discountTotal > 0 && <Row label="Diskon" value={`-${formatRupiah(t.discountTotal)}`} />}
            {t.serviceTotal > 0 && <Row label="Service" value={formatRupiah(t.serviceTotal)} />}
            {t.taxTotal > 0 && <Row label="Pajak" value={formatRupiah(t.taxTotal)} />}
            <Row label="TOTAL" value={formatRupiah(t.grandTotal)} testId="checkout-total" strong />
          </div>
        </section>
        <section className="flex flex-col gap-3">
          <PaymentComposer remaining={remaining} payments={payments} onChange={setPayments} />
          <Row label="Sisa" value={formatRupiah(Math.max(0, remaining))} testId="checkout-remaining" />
          <Row label="Kembalian" value={formatRupiah(change)} testId="checkout-change" />
          {remaining < 0 && <p className="text-sm text-rose-600">Pembayaran melebihi total — hapus salah satu pembayaran.</p>}
          {blocked && <p className="text-sm font-semibold text-rose-600">{blocked}</p>}
          <Button size="lg" disabled={!!blocked || remaining !== 0 || pay.isPending} onClick={submit}>Bayar</Button>
        </section>
      </div>
      {editing && (
        <DiscountEditor
          title={editing === 'bill' ? 'Diskon bill' : 'Diskon item'}
          initial={editing === 'bill' ? b.billDiscount : (b.lines.find((l) => l.id === editing)?.discount ?? null)}
          onSave={saveDiscount}
          onClose={() => setEditing(null)}
        />
      )}
      {merging && <MergeDialog targetId={billId} onClose={() => setMerging(false)} />}
    </Modal>
  );
}
```

`App.tsx`: import `CheckoutHost` dan render `<CheckoutHost />` setelah `<PinPrompt />`.

- [ ] **Step 5: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): checkout dialog with discounts, merge and split payments"
```

---

### Task 13: Web — pesanan di layar Meja, Stop & Bayar, tagihan lepas, strip "Belum dibayar"

**Files:**
- Create: `apps/web/src/features/orders/OrderDialog.tsx`, `apps/web/src/features/orders/BillItems.tsx`, `apps/web/src/features/orders/UnpaidStrip.tsx`, `apps/web/src/features/orders/NewBillButton.tsx`
- Modify: `apps/web/src/features/board/ActiveSession.tsx`, `apps/web/src/features/board/StopDialog.tsx`, `apps/web/src/features/board/StartSession.tsx`, `apps/web/src/features/board/BoardPage.tsx`, `apps/web/src/features/board/UnitPanel.test.tsx`
- Test: `apps/web/src/features/orders/OrderDialog.test.tsx`, `apps/web/src/features/orders/BillItems.test.tsx`

**Interfaces:**
- Consumes: `useBill`, `useBillAction`, `useBillPreview` (Task 12), `useCheckout` (Task 12), `useHasShift` (Task 10), route item/bill (Task 7); `ProductDto`, `CategoryDto`, `BillSummary`.
- Produces:
  - `OrderDialog({ billId, title, open, onClose })`: kategori (tab "Semua" + kategori aktif), pencarian (label **"Cari produk"**), kartu produk (nama + harga; "Stok habis" bila STOCK & ≤ 0), **"Item manual"** (input **"Nama item"**, **"Harga"**, tombol **"Masukkan"**), keranjang, tombol **"Tambahkan"** → `POST /bills/:id/items`.
  - `BillItems({ billId })` di panel meja aktif: daftar item non-TIME, tombol **"+ Pesan"** dan total sementara (`data-testid="bill-running-total"`).
  - `ActiveSession`: tombol **"Stop"** dan **"Stop & Bayar"**; `StopDialog` mendapat prop `billId` dan `andPay` (tombol konfirmasi **"Ya, stop"** / **"Ya, stop & bayar"**; `andPay` membuka checkout global setelah stop).
  - `UnpaidStrip`: region `aria-label="Belum dibayar"` berisi tombol per bill OPEN tanpa sesi aktif (`"<label> · Rp…"`) → checkout.
  - `NewBillButton`: **"+ Transaksi baru"** → `POST /bills` lalu `OrderDialog`.
  - `StartSession`: **"Mulai"** nonaktif tanpa shift, dengan teks "Buka shift dulu untuk memulai".

- [ ] **Step 1: Tulis test yang gagal**

`apps/web/src/features/orders/OrderDialog.test.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { OrderDialog } from './OrderDialog';

afterEach(() => vi.unstubAllGlobals());

it('memilih produk, item manual, lalu menambahkan ke bill', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/categories') return json([{ id: 'c1', name: 'Minuman', color: '#06B6D4', sortOrder: 0, active: true }]);
    if (url === '/api/products') return json([
      { id: 'p1', name: 'Es Teh', categoryId: 'c1', kind: 'STOCK', price: 8000, stockQty: 5, active: true },
      { id: 'p2', name: 'Kopi', categoryId: 'c1', kind: 'STOCK', price: 15000, stockQty: 0, active: true },
      { id: 'p3', name: 'Lama', categoryId: 'c1', kind: 'STOCK', price: 1000, stockQty: 1, active: false },
    ]);
    if (url === '/api/bills/b1/items' && init?.method === 'POST') return json({ id: 'b1' });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's' } } });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OrderDialog billId="b1" title="Pesan · Meja 1" open onClose={onClose} />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole('button', { name: /Es Teh/ }));
  await userEvent.click(screen.getByRole('button', { name: /Es Teh/ }));
  expect(screen.getByRole('button', { name: /Kopi/ })).toHaveTextContent('Stok habis');
  expect(screen.queryByRole('button', { name: /Lama/ })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Item manual' }));
  await userEvent.type(screen.getByLabelText('Nama item'), 'Charger');
  await userEvent.type(screen.getByLabelText('Harga'), '5000');
  await userEvent.click(screen.getByRole('button', { name: 'Masukkan' }));
  await userEvent.click(screen.getByRole('button', { name: 'Tambahkan' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  const call = fetchMock.mock.calls.find(([u]) => u === '/api/bills/b1/items')!;
  expect(JSON.parse(String(call[1]!.body))).toEqual({ items: [{ productId: 'p1', qty: 2 }, { custom: { name: 'Charger', price: 5000 }, qty: 1 }] });
});
```

`apps/web/src/features/orders/BillItems.test.tsx`:
```tsx
import { DEFAULT_TRANSACTION_SETTINGS, type BillView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PinPrompt } from '../../components/PinPrompt';
import { useBoard } from '../../stores/board';
import { BillItems } from './BillItems';

const bill: BillView = {
  id: 'b1', number: 'FP-1', label: 'Meja 1', status: 'OPEN', createdAt: '', createdByName: 'k', billDiscount: null,
  lines: [{ id: 'l2', type: 'PRODUCT', productId: 'p1', sessionId: null, name: 'Es Teh', unitPrice: 8000, qty: 2, discount: null, breakdown: null }],
  activeSessions: [], payments: [], stored: null, paidAt: null, paidByName: null, shiftId: null, mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null,
};

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('kasir mengurangi qty → minta PIN lalu PATCH dengan approvalPin', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's' } } });
    if (url === '/api/bills/b1' && (!init || init.method === 'GET')) return json(bill);
    if (url === '/api/bills/b1/items/l2' && init?.method === 'PATCH') return json({ ...bill, lines: [{ ...bill.lines[0], qty: 1 }] });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BillItems billId="b1" />
      <PinPrompt />
    </QueryClientProvider>,
  );
  expect(await screen.findByTestId('bill-running-total')).toHaveTextContent('Rp 16.000');
  await userEvent.click(screen.getByRole('button', { name: 'Kurangi Es Teh' }));
  await userEvent.type(await screen.findByLabelText('PIN supervisor'), '1111');
  await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u, i]) => u === '/api/bills/b1/items/l2' && i?.method === 'PATCH');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ qty: 1, approvalPin: '1111' });
  });
});
```

Perbarui `UnitPanel.test.tsx`: di `mockFetch`, sebelum `return new Response('{}', { status: 404 })`, tambahkan
```ts
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's1', openedAt: '2026-10-01T01:00:00.000Z', openedByName: 'Kasir' } } });
```
agar tombol Mulai tetap aktif di test M1.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- OrderDialog BillItems`
Expected: FAIL — modul belum ada.

- [ ] **Step 3: OrderDialog**

`apps/web/src/features/orders/OrderDialog.tsx`:
```tsx
import type { CategoryDto, ProductDto } from '@funplay/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useHasShift } from '../../hooks/useShift';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRupiah, parseRupiah } from '../../lib/format';
import { showError, toast } from '../../stores/toast';

type CartItem = { key: string; name: string; price: number; qty: number } & ({ productId: string } | { custom: { name: string; price: number } });

export function OrderDialog({ billId, title, open, onClose }: { billId: string; title: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const hasShift = useHasShift();
  const categories = useQuery({ queryKey: ['/categories'], queryFn: () => api<CategoryDto[]>('GET', '/categories'), enabled: open });
  const products = useQuery({ queryKey: ['/products'], queryFn: () => api<ProductDto[]>('GET', '/products'), enabled: open });
  const [cat, setCat] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [manual, setManual] = useState<null | { name: string; price: string }>(null);
  useEffect(() => {
    if (open) {
      setCart([]);
      setSearch('');
      setManual(null);
    }
  }, [open]);

  const add = useMutation({
    mutationFn: () =>
      api('POST', `/bills/${billId}/items`, {
        items: cart.map((c) => ('productId' in c ? { productId: c.productId, qty: c.qty } : { custom: c.custom, qty: c.qty })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['bill', billId] });
      void qc.invalidateQueries({ queryKey: ['bills'] });
      toast.success('Pesanan ditambahkan');
      onClose();
    },
    onError: showError,
  });

  const color = new Map((categories.data ?? []).map((c) => [c.id, c.color]));
  const list = (products.data ?? []).filter(
    (p) => p.active && (cat === 'ALL' || p.categoryId === cat) && p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const bump = (key: string, d: number) =>
    setCart((cs) => cs.map((c) => (c.key === key ? { ...c, qty: c.qty + d } : c)).filter((c) => c.qty > 0));
  const pick = (p: ProductDto) =>
    setCart((cs) => (cs.some((c) => c.key === p.id) ? cs.map((c) => (c.key === p.id ? { ...c, qty: c.qty + 1 } : c)) : [...cs, { key: p.id, productId: p.id, name: p.name, price: p.price, qty: 1 }]));
  const addManual = () => {
    if (!manual || !manual.name.trim()) return;
    const price = parseRupiah(manual.price);
    setCart((cs) => [...cs, { key: `m-${cs.length}-${manual.name}`, custom: { name: manual.name.trim(), price }, name: manual.name.trim(), price, qty: 1 }]);
    setManual(null);
  };
  const total = cart.reduce((a, c) => a + c.price * c.qty, 0);

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={title} width="max-w-4xl">
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {[{ id: 'ALL', name: 'Semua' }, ...(categories.data ?? []).filter((c) => c.active)].map((c) => (
              <button key={c.id} type="button" onClick={() => setCat(c.id)}
                className={cn('rounded-full px-3 py-1 text-sm font-semibold', cat === c.id ? 'bg-primary text-white' : 'bg-primary-soft text-primary-ink')}>
                {c.name}
              </button>
            ))}
          </div>
          <label className="text-sm font-semibold">
            Cari produk
            <Input className="mt-1" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="grid max-h-[50vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
            {list.map((p) => (
              <button key={p.id} type="button" onClick={() => pick(p)}
                className="flex flex-col items-start gap-1 rounded-xl border-l-4 bg-bg p-3 text-left text-sm font-semibold transition hover:brightness-95"
                style={{ borderLeftColor: color.get(p.categoryId) ?? '#7C3AED' }}>
                <span>{p.name}</span>
                <span className="text-primary-ink">{formatRupiah(p.price)}</span>
                {p.kind === 'STOCK' && p.stockQty <= 0 && <span className="text-xs text-rose-600">Stok habis</span>}
              </button>
            ))}
          </div>
          {manual ? (
            <div className="grid grid-cols-[1fr_8rem_auto] items-end gap-2">
              <label className="text-sm font-semibold">Nama item<Input className="mt-1" autoFocus value={manual.name} maxLength={60} onChange={(e) => setManual({ ...manual, name: e.target.value })} /></label>
              <label className="text-sm font-semibold">Harga<Input className="mt-1" inputMode="numeric" value={manual.price} onChange={(e) => setManual({ ...manual, price: e.target.value.replace(/\D/g, '') })} /></label>
              <Button onClick={addManual}>Masukkan</Button>
            </div>
          ) : (
            <Button variant="soft" className="self-start" onClick={() => setManual({ name: '', price: '' })}>Item manual</Button>
          )}
        </div>
        <aside className="flex flex-col gap-2 rounded-xl bg-bg p-3">
          <h3 className="font-bold">Keranjang</h3>
          {cart.length === 0 && <p className="text-sm text-muted">Pilih produk di sebelah kiri.</p>}
          {cart.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <button type="button" aria-label={`Kurangi ${c.name} di keranjang`} onClick={() => bump(c.key, -1)}><Minus size={14} /></button>
              <span className="w-6 text-center tabular-nums">{c.qty}</span>
              <button type="button" aria-label={`Tambah ${c.name} di keranjang`} onClick={() => bump(c.key, 1)}><Plus size={14} /></button>
            </div>
          ))}
          <div className="mt-auto flex justify-between border-t border-line pt-2 font-bold">
            <span>Total</span>
            <span className="tabular-nums">{formatRupiah(total)}</span>
          </div>
          {!hasShift && <p className="text-xs text-rose-600">Buka shift dulu untuk menambah pesanan.</p>}
          <Button disabled={cart.length === 0 || add.isPending || !hasShift} onClick={() => add.mutate()}>Tambahkan</Button>
        </aside>
      </div>
    </Modal>
  );
}
```
Tanpa shift (respons `/api/shifts/current` kosong) tombol "Tambahkan" nonaktif — karena itu test memalsukan shift terbuka.

- [ ] **Step 4: BillItems, StopDialog, ActiveSession, StartSession**

`apps/web/src/features/orders/BillItems.tsx`:
```tsx
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useBill, useBillAction, useBillPreview } from '../../hooks/useBill';
import { useNow } from '../../hooks/useNow';
import { useHasShift } from '../../hooks/useShift';
import { formatRupiah } from '../../lib/format';
import { approvalPin } from '../../stores/pin';
import { useMe } from '../auth/auth';
import { OrderDialog } from './OrderDialog';

export function BillItems({ billId }: { billId: string }) {
  const me = useMe().data;
  const bill = useBill(billId);
  const now = useNow();
  const preview = useBillPreview(bill.data, now);
  const action = useBillAction(billId);
  const hasShift = useHasShift();
  const [ordering, setOrdering] = useState(false);
  if (!bill.data || !me) return null;
  const items = bill.data.lines.filter((l) => l.type !== 'TIME');
  const path = (lineId: string) => `/bills/${billId}/items/${lineId}`;

  const decrease = async (lineId: string, name: string, qty: number) => {
    const pin = await approvalPin(me.role, `PIN supervisor untuk mengurangi ${name}`);
    if (pin === null) return;
    action.mutate({ method: 'PATCH', path: path(lineId), body: { qty: qty - 1, ...(pin ? { approvalPin: pin } : {}) } });
  };
  const remove = async (lineId: string, name: string) => {
    const pin = await approvalPin(me.role, `PIN supervisor untuk menghapus ${name}`);
    if (pin === null) return;
    action.mutate({ method: 'DELETE', path: path(lineId), body: pin ? { approvalPin: pin } : {} });
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-bg p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-bold">Pesanan</span>
        <Button size="sm" variant="soft" disabled={!hasShift} onClick={() => setOrdering(true)}>+ Pesan</Button>
      </div>
      {items.length === 0 && <p className="text-muted">Belum ada pesanan.</p>}
      {items.map((l) => (
        <div key={l.id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">{l.name}</span>
          <button type="button" aria-label={`Kurangi ${l.name}`} disabled={l.qty <= 1 || action.isPending} onClick={() => decrease(l.id, l.name, l.qty)} className="disabled:opacity-30"><Minus size={14} /></button>
          <span className="w-6 text-center tabular-nums">{l.qty}</span>
          <button type="button" aria-label={`Tambah ${l.name}`} disabled={action.isPending} onClick={() => action.mutate({ method: 'PATCH', path: path(l.id), body: { qty: l.qty + 1 } })}><Plus size={14} /></button>
          <span className="w-20 text-right tabular-nums">{formatRupiah(l.unitPrice * l.qty)}</span>
          <button type="button" aria-label={`Hapus ${l.name}`} disabled={action.isPending} onClick={() => remove(l.id, l.name)} className="text-rose-600"><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="flex justify-between border-t border-line pt-2 font-extrabold text-primary">
        <span>Total sementara</span>
        <span className="tabular-nums" data-testid="bill-running-total">{formatRupiah(preview?.totals.grandTotal ?? 0)}</span>
      </div>
      <OrderDialog billId={billId} title={`Pesan · ${bill.data.label}`} open={ordering} onClose={() => setOrdering(false)} />
    </div>
  );
}
```

`StopDialog.tsx` — props menjadi `{ unitName; sessionId; billId; andPay?: boolean; preview; open; onClose }`. Di `onSuccess`, setelah `toast.success(...)` dan `props.onClose()`: `if (props.andPay) useCheckout.getState().open(props.billId);`. Tombol konfirmasi: `{props.andPay ? 'Ya, stop & bayar' : 'Ya, stop'}`; judul tetap `Stop ${props.unitName}?`.

`ActiveSession.tsx`:
- `useState<null | 'extend' | 'move' | 'stop' | 'stopPay'>`.
- Setelah `<ChargeLines charge={charge} />` tambahkan `<BillItems billId={session.billId} />`.
- Ganti tombol tunggal Stop dengan:
```tsx
      <div className="grid grid-cols-2 gap-2">
        <Button variant="danger" size="lg" onClick={() => setDialog('stop')}>Stop</Button>
        <Button size="lg" onClick={() => setDialog('stopPay')}>Stop & Bayar</Button>
      </div>
```
- `StopDialog` dirender dengan `billId={session.billId}`, `andPay={dialog === 'stopPay'}`, `open={dialog === 'stop' || dialog === 'stopPay'}`.

`StartSession.tsx`: `const hasShift = useHasShift();`; tombol Mulai `disabled={!hasShift || action.isPending || (mode === 'PACKAGE' && !packageId)}`; di atas tombol: `{!hasShift && <p className="text-sm text-amber-700">Buka shift dulu untuk memulai.</p>}`.

- [ ] **Step 5: Strip "Belum dibayar" & tagihan lepas di BoardPage**

`apps/web/src/features/orders/UnpaidStrip.tsx`:
```tsx
import type { BillSummary } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { useCheckout } from '../../stores/checkout';

export function UnpaidStrip() {
  const q = useQuery({ queryKey: ['bills', { status: 'OPEN' }], queryFn: () => api<BillSummary[]>('GET', '/bills?status=OPEN') });
  const open = useCheckout((s) => s.open);
  const unpaid = (q.data ?? []).filter((b) => !b.hasActiveSession);
  if (!unpaid.length) return null;
  return (
    <div role="region" aria-label="Belum dibayar" className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
      <span className="text-sm font-bold text-amber-900 dark:text-amber-200">Belum dibayar:</span>
      {unpaid.map((b) => (
        <button key={b.id} type="button" onClick={() => open(b.id)}
          className="rounded-full bg-amber-200 px-3 py-1 text-sm font-semibold text-amber-950 hover:bg-amber-300">
          {b.label} · {formatRupiah(b.total)}
        </button>
      ))}
    </div>
  );
}
```

`apps/web/src/features/orders/NewBillButton.tsx`:
```tsx
import type { BillView } from '@funplay/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { useHasShift } from '../../hooks/useShift';
import { api } from '../../lib/api';
import { showError } from '../../stores/toast';
import { OrderDialog } from './OrderDialog';

export function NewBillButton() {
  const qc = useQueryClient();
  const hasShift = useHasShift();
  const [bill, setBill] = useState<BillView | null>(null);
  const create = useMutation({
    mutationFn: () => api<BillView>('POST', '/bills', {}),
    onSuccess: (b) => {
      qc.setQueryData(['bill', b.id], b);
      void qc.invalidateQueries({ queryKey: ['bills'] });
      setBill(b);
    },
    onError: showError,
  });
  return (
    <>
      <Button size="sm" variant="soft" disabled={!hasShift || create.isPending} onClick={() => create.mutate()}>+ Transaksi baru</Button>
      {bill && <OrderDialog billId={bill.id} title={`Pesan · ${bill.label}`} open onClose={() => setBill(null)} />}
    </>
  );
}
```

`BoardPage.tsx`: baris filter menjadi `<div className="flex flex-wrap items-center gap-2">…chips…<span className="ml-auto"><NewBillButton /></span></div>`; tepat di bawahnya `<UnpaidStrip />`.

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS (termasuk `UnitPanel.test` yang fixture-nya diperbarui).

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): order dialog, bill items, stop & pay, unpaid strip and standalone bills"
```

---

### Task 14: Web — halaman Transaksi & panel simulator printer

**Files:**
- Create: `apps/web/src/features/transactions/TransactionsPage.tsx`, `apps/web/src/features/transactions/BillDetail.tsx`, `apps/web/src/features/printing/PrinterSimulatorPanel.tsx`
- Modify: `apps/web/src/lib/format.ts`, `apps/web/src/lib/format.test.ts`, `apps/web/src/App.tsx`, `apps/web/src/features/layout/AppShell.tsx`
- Test: `apps/web/src/features/transactions/BillDetail.test.tsx`

**Interfaces:**
- Consumes: `GET /api/bills`, `POST /api/bills/:id/{print,void,cancel}`, `GET /api/print/jobs` (Task 7–9); `useBill`, `useBillPreview`, `useCheckout` (Task 12); `OrderDialog` (Task 13); `BILL_STATUS_LABEL`, `PAYMENT_METHOD_LABEL`, `PrintJobView`.
- Produces:
  - `localDayRange(date: 'YYYY-MM-DD', utcOffsetMin): { from: string; to: string }` (ISO) dan `localDateInput(now: Date, utcOffsetMin): string` di `lib/format.ts`.
  - Route `/transactions` + menu sidebar **"Transaksi"** (semua role).
  - `TransactionsPage`: filter **"Tanggal"**, **"Status"**, **"Cari"**; tabel bill; panel `BillDetail`.
  - `BillDetail({ billId })`: aksi **"Tambah pesanan"**, **"Bayar"**, **"Batalkan"** (OPEN); **"Cetak ulang"**, **"Void"** (PAID); **"Cetak ulang"** (VOID). Dialog alasan: input **"Alasan"**, tombol **"Lanjut"**.
  - `PrinterSimulatorPanel` (tampil bila driver `SIMULATOR`): tombol **"Struk"**, judul **"Simulator printer"**, pratinjau `data-testid="receipt-preview"`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `apps/web/src/lib/format.test.ts`:
```ts
  it('localDayRange: hari lokal outlet → rentang UTC', () => {
    expect(localDayRange('2026-10-01', 420)).toEqual({ from: '2026-09-30T17:00:00.000Z', to: '2026-10-01T17:00:00.000Z' });
    expect(localDateInput(new Date('2026-09-30T18:30:00Z'), 420)).toBe('2026-10-01');
  });
```

`apps/web/src/features/transactions/BillDetail.test.tsx`:
```tsx
import { DEFAULT_TRANSACTION_SETTINGS, type BillView } from '@funplay/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PinPrompt } from '../../components/PinPrompt';
import { useBoard } from '../../stores/board';
import { BillDetail } from './BillDetail';

const paid: BillView = {
  id: 'b1', number: 'FP-20261001-0001', label: 'Tagihan lepas', status: 'PAID', createdAt: '2026-10-01T03:00:00.000Z', createdByName: 'Kasir', billDiscount: null,
  lines: [{ id: 'l1', type: 'PRODUCT', productId: 'p1', sessionId: null, name: 'Kopi Susu', unitPrice: 15000, qty: 1, discount: null, breakdown: null }],
  activeSessions: [],
  payments: [{ id: 'pay1', method: 'CASH', amount: 15000, received: 20000, change: 5000, reference: null, createdAt: '2026-10-01T03:05:00.000Z' }],
  stored: { subtotal: 15000, discountTotal: 0, serviceTotal: 0, taxTotal: 0, grandTotal: 15000 },
  paidAt: '2026-10-01T03:05:00.000Z', paidByName: 'Kasir', shiftId: 's1', mergedIntoId: null, cancelReason: null, voidReason: null, voidedAt: null,
};

beforeEach(() => {
  useBoard.setState({
    ...useBoard.getInitialState(),
    settings: { outletType: 'BILLIARD', outletName: 'FunPlay', address: '', utcOffsetMin: 420, roundingBlockMin: 15, minChargeMin: 60, warnBeforeMin: 5, pauseKeepsLightOn: true, autoOffUnexpected: false, ...DEFAULT_TRANSACTION_SETTINGS },
  });
});
afterEach(() => vi.unstubAllGlobals());

it('void bill lunas: alasan lalu PIN supervisor', async () => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url === '/api/auth/me') return json({ user: { id: 'k', name: 'Kasir', username: 'kasir', role: 'KASIR' } });
    if (url === '/api/shifts/current') return json({ summary: { shift: { id: 's1' } } });
    if (url === '/api/bills/b1' && (!init || init.method === 'GET')) return json(paid);
    if (url === '/api/bills/b1/void' && init?.method === 'POST') return json({ ...paid, status: 'VOID', voidReason: 'salah input' });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BillDetail billId="b1" />
      <PinPrompt />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Kopi Susu')).toBeInTheDocument();
  expect(screen.getByText(/Kembalian/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Void' }));
  await userEvent.type(screen.getByLabelText('Alasan'), 'salah input');
  await userEvent.click(screen.getByRole('button', { name: 'Lanjut' }));
  await userEvent.type(await screen.findByLabelText('PIN supervisor'), '1111');
  await userEvent.click(screen.getByRole('button', { name: 'Konfirmasi' }));
  await waitFor(() => {
    const call = fetchMock.mock.calls.find(([u]) => u === '/api/bills/b1/void');
    expect(JSON.parse(String(call![1]!.body))).toEqual({ reason: 'salah input', approvalPin: '1111' });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm --filter @funplay/web test -- BillDetail format`
Expected: FAIL.

- [ ] **Step 3: Helper tanggal**

`apps/web/src/lib/format.ts`:
```ts
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" (hari lokal outlet) → rentang UTC [from, to). */
export function localDayRange(date: string, utcOffsetMin: number): { from: string; to: string } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const from = Date.UTC(y, m - 1, d) - utcOffsetMin * 60_000;
  return { from: new Date(from).toISOString(), to: new Date(from + 86_400_000).toISOString() };
}

/** Tanggal lokal outlet untuk <input type="date">. */
export function localDateInput(now: Date, utcOffsetMin: number): string {
  const l = new Date(now.getTime() + utcOffsetMin * 60_000);
  return `${l.getUTCFullYear()}-${pad2(l.getUTCMonth() + 1)}-${pad2(l.getUTCDate())}`;
}
```

- [ ] **Step 4: BillDetail**

`apps/web/src/features/transactions/BillDetail.tsx`:
```tsx
import { BILL_STATUS_LABEL, formatReceiptDate, PAYMENT_METHOD_LABEL } from '@funplay/shared';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Modal } from '../../components/ui/modal';
import { useBill, useBillAction, useBillPreview } from '../../hooks/useBill';
import { useNow } from '../../hooks/useNow';
import { api } from '../../lib/api';
import { formatRupiah } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { useCheckout } from '../../stores/checkout';
import { approvalPin } from '../../stores/pin';
import { showError, toast } from '../../stores/toast';
import { useMe } from '../auth/auth';
import { OrderDialog } from '../orders/OrderDialog';

function ReasonDialog({ title, onSubmit, onClose }: { title: string; onSubmit: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reason.trim()) onSubmit(reason.trim());
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={title} width="max-w-sm">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="text-sm font-semibold">Alasan<Input className="mt-1" autoFocus maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Batal</Button>
          <Button type="submit" disabled={!reason.trim()}>Lanjut</Button>
        </div>
      </form>
    </Modal>
  );
}

export function BillDetail({ billId }: { billId: string }) {
  const me = useMe().data;
  const bill = useBill(billId);
  const now = useNow();
  const preview = useBillPreview(bill.data, now);
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const action = useBillAction(billId);
  const openCheckout = useCheckout((s) => s.open);
  const [asking, setAsking] = useState<null | 'void' | 'cancel'>(null);
  const [ordering, setOrdering] = useState(false);
  const reprint = useMutation({ mutationFn: () => api('POST', `/bills/${billId}/print`, {}), onSuccess: () => toast.success('Struk dikirim ke printer'), onError: showError });

  if (!bill.data || !me) return <div className="text-sm text-muted">Memuat…</div>;
  const b = bill.data;
  const totals = b.stored ?? (preview ? { ...preview.totals } : null);
  const when = (iso: string | null) => (iso ? formatReceiptDate(new Date(iso), offset) : '—');

  const confirmReason = async (reason: string) => {
    const kind = asking;
    setAsking(null);
    if (kind === 'void') {
      const pin = await approvalPin(me.role, 'PIN supervisor untuk void');
      if (pin === null) return;
      action.mutate({ method: 'POST', path: `/bills/${billId}/void`, body: { reason, ...(pin ? { approvalPin: pin } : {}) } });
    } else if (kind === 'cancel') {
      const needsPin = (preview?.totals.grandTotal ?? 0) > 0;
      const pin = needsPin ? await approvalPin(me.role, 'PIN supervisor untuk membatalkan bill') : undefined;
      if (pin === null) return;
      action.mutate({ method: 'POST', path: `/bills/${billId}/cancel`, body: { reason, ...(pin ? { approvalPin: pin } : {}) } });
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-surface p-4 shadow-sm">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-extrabold">{b.label}</h2>
          <p className="text-xs text-muted">{b.number} · dibuat {when(b.createdAt)} oleh {b.createdByName}</p>
          {b.paidAt && <p className="text-xs text-muted">Dibayar {when(b.paidAt)} oleh {b.paidByName}</p>}
        </div>
        <span className="rounded-full bg-primary-soft px-3 py-1 text-xs font-bold text-primary-ink">{BILL_STATUS_LABEL[b.status]}</span>
      </header>
      <div className="flex flex-col gap-1 text-sm">
        {b.lines.map((l) => (
          <div key={l.id} className="flex justify-between">
            <span>{l.name}{l.qty > 1 ? ` × ${l.qty}` : ''}</span>
            <span className="tabular-nums">{formatRupiah(l.unitPrice * l.qty)}</span>
          </div>
        ))}
        {b.activeSessions.map((s) => <p key={s.id} className="text-amber-700">{s.unitName} masih berjalan</p>)}
      </div>
      {totals && (
        <div className="flex flex-col gap-1 border-t border-line pt-2 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{formatRupiah(totals.subtotal)}</span></div>
          {totals.discountTotal > 0 && <div className="flex justify-between"><span>Diskon</span><span className="tabular-nums">-{formatRupiah(totals.discountTotal)}</span></div>}
          {totals.serviceTotal > 0 && <div className="flex justify-between"><span>Service</span><span className="tabular-nums">{formatRupiah(totals.serviceTotal)}</span></div>}
          {totals.taxTotal > 0 && <div className="flex justify-between"><span>Pajak</span><span className="tabular-nums">{formatRupiah(totals.taxTotal)}</span></div>}
          <div className="flex justify-between text-base font-extrabold text-primary"><span>Total</span><span className="tabular-nums">{formatRupiah(totals.grandTotal)}</span></div>
        </div>
      )}
      {b.payments.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl bg-bg p-2 text-sm">
          {b.payments.map((p) => (
            <div key={p.id} className="flex justify-between">
              <span>{PAYMENT_METHOD_LABEL[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span>
              <span className="tabular-nums">{formatRupiah(p.received ?? p.amount)}</span>
            </div>
          ))}
          {b.payments.some((p) => (p.change ?? 0) > 0) && (
            <div className="flex justify-between text-muted"><span>Kembalian</span><span className="tabular-nums">{formatRupiah(b.payments.reduce((a, p) => a + (p.change ?? 0), 0))}</span></div>
          )}
        </div>
      )}
      {b.voidReason && <p className="text-sm text-rose-700">Void: {b.voidReason}</p>}
      {b.cancelReason && <p className="text-sm text-muted">Dibatalkan: {b.cancelReason}</p>}
      <div className="flex flex-wrap gap-2">
        {b.status === 'OPEN' && (
          <>
            <Button size="sm" variant="soft" onClick={() => setOrdering(true)}>Tambah pesanan</Button>
            <Button size="sm" onClick={() => openCheckout(b.id)}>Bayar</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking('cancel')}>Batalkan</Button>
          </>
        )}
        {(b.status === 'PAID' || b.status === 'VOID') && <Button size="sm" variant="soft" onClick={() => reprint.mutate()}>Cetak ulang</Button>}
        {b.status === 'PAID' && <Button size="sm" variant="danger" onClick={() => setAsking('void')}>Void</Button>}
      </div>
      {asking && <ReasonDialog title={asking === 'void' ? 'Void bill' : 'Batalkan bill'} onSubmit={confirmReason} onClose={() => setAsking(null)} />}
      {ordering && <OrderDialog billId={b.id} title={`Pesan · ${b.label}`} open onClose={() => setOrdering(false)} />}
    </div>
  );
}
```

- [ ] **Step 5: TransactionsPage & PrinterSimulatorPanel**

`apps/web/src/features/transactions/TransactionsPage.tsx`:
```tsx
import { BILL_STATUS_LABEL, BILL_STATUSES, localHHMM, type BillStatus, type BillSummary } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Input } from '../../components/ui/input';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatRupiah, localDateInput, localDayRange } from '../../lib/format';
import { useBoard } from '../../stores/board';
import { BillDetail } from './BillDetail';

export function TransactionsPage() {
  const offset = useBoard((s) => s.settings?.utcOffsetMin ?? 420);
  const [date, setDate] = useState(() => localDateInput(new Date(), offset));
  const [status, setStatus] = useState<'' | BillStatus>('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const range = localDayRange(date, offset);
  const params = new URLSearchParams({ from: range.from, to: range.to, ...(status ? { status } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
  const bills = useQuery({ queryKey: ['bills', { date, status, q }], queryFn: () => api<BillSummary[]>('GET', `/bills?${params}`) });

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[1fr_420px]">
      <section className="flex min-h-0 flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-semibold">Tanggal<Input className="mt-1" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <label className="text-sm font-semibold">
            Status
            <select className="mt-1 h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value as '' | BillStatus)}>
              <option value="">Semua</option>
              {BILL_STATUSES.map((s) => <option key={s} value={s}>{BILL_STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="text-sm font-semibold">Cari<Input className="mt-1" placeholder="No. bill / label" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        <div className="min-h-0 overflow-y-auto rounded-2xl bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface text-left text-muted">
              <tr><th className="p-3">No. bill</th><th>Label</th><th>Status</th><th>Jam</th><th className="pr-3 text-right">Total</th></tr>
            </thead>
            <tbody>
              {(bills.data ?? []).map((b) => (
                <tr key={b.id} onClick={() => setSelected(b.id)} className={cn('cursor-pointer border-t border-line hover:bg-primary-soft/40', selected === b.id && 'bg-primary-soft')}>
                  <td className="p-3 font-mono text-xs">{b.number}</td>
                  <td>{b.label}</td>
                  <td>{BILL_STATUS_LABEL[b.status]}</td>
                  <td>{localHHMM(new Date(b.createdAt), offset)}</td>
                  <td className="pr-3 text-right tabular-nums">{formatRupiah(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bills.data?.length === 0 && <p className="p-4 text-sm text-muted">Tidak ada transaksi.</p>}
        </div>
      </section>
      <aside className="min-h-0 overflow-y-auto">{selected ? <BillDetail key={selected} billId={selected} /> : <p className="text-sm text-muted">Pilih transaksi untuk melihat detail.</p>}</aside>
    </div>
  );
}
```

`apps/web/src/features/printing/PrinterSimulatorPanel.tsx`:
```tsx
import type { PrintJobView } from '@funplay/shared';
import { useQuery } from '@tanstack/react-query';
import { Printer, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { useBoard } from '../../stores/board';

const KIND_LABEL: Record<PrintJobView['kind'], string> = { RECEIPT: 'Struk', SHIFT_REPORT: 'Rekap shift', TEST: 'Tes cetak' };

export function PrinterSimulatorPanel() {
  const driver = useBoard((s) => s.settings?.printerDriver);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const jobs = useQuery({ queryKey: ['printJobs'], queryFn: () => api<PrintJobView[]>('GET', '/print/jobs?limit=20'), enabled: open && driver === 'SIMULATOR' });
  if (driver !== 'SIMULATOR') return null;
  if (!open) {
    return (
      <Button className="fixed bottom-4 left-20 z-30 shadow-lg" variant="soft" onClick={() => setOpen(true)}>
        <Printer size={16} /> Struk
      </Button>
    );
  }
  const list = jobs.data ?? [];
  const job = list.find((j) => j.id === picked) ?? list[0];
  return (
    <div className="fixed bottom-4 left-20 z-30 flex max-h-[80vh] w-[min(42rem,calc(100vw-6rem))] gap-3 rounded-2xl border border-line bg-surface p-4 shadow-2xl">
      <div className="flex w-44 flex-col gap-1 overflow-y-auto">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-bold">Simulator printer</h3>
          <button type="button" aria-label="Tutup simulator printer" onClick={() => setOpen(false)}><X size={18} /></button>
        </div>
        {list.length === 0 && <p className="text-xs text-muted">Belum ada cetakan.</p>}
        {list.map((j) => (
          <button key={j.id} type="button" onClick={() => setPicked(j.id)}
            className={cn('rounded-lg px-2 py-1 text-left text-xs', job?.id === j.id ? 'bg-primary-soft font-bold' : 'hover:bg-bg')}>
            {KIND_LABEL[j.kind]} · {new Date(j.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            {j.status !== 'DONE' && <span className={j.status === 'FAILED' ? ' text-rose-600' : ' text-muted'}> · {j.status === 'FAILED' ? 'gagal' : 'proses'}</span>}
          </button>
        ))}
      </div>
      <pre data-testid="receipt-preview" className="min-w-0 flex-1 overflow-auto rounded-lg bg-white p-3 font-mono text-[11px] leading-tight text-black" style={{ maxWidth: '50ch' }}>
        {job?.previewText ?? ''}
      </pre>
    </div>
  );
}
```

Pemasangan:
- `App.tsx`: route `<Route path="transactions" element={<TransactionsPage />} />`.
- `AppShell.tsx`: `items` ditambah `{ to: '/transactions', label: 'Transaksi', icon: Receipt, show: true }` (setelah Meja); render `<PrinterSimulatorPanel />` di root layout (sebelum `<OpenShiftDialog />`).

- [ ] **Step 6: Jalankan test & typecheck**

Run: `pnpm --filter @funplay/web test && pnpm --filter @funplay/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): transactions page with reprint/void/cancel and printer simulator panel"
```

---
### Task 15: Seed katalog demo, E2E transaksi, README

**Files:**
- Modify: `apps/server/src/seed-data.ts`, `apps/server/test/seed.test.ts`
- Create: `e2e/helpers.ts`, `e2e/transaksi.spec.ts`
- Modify: `e2e/kasir.spec.ts`, `README.md`

**Interfaces:**
- Consumes: semua task sebelumnya; label UI yang ditetapkan Task 10–14.
- Produces: data demo kategori **Minuman / Makanan / Layanan** dengan produk **"Es Teh Manis" (8.000)**, **"Kopi Susu" (15.000)**, **"Air Mineral" (6.000)**, **"Mie Goreng" (15.000)**, **"Kentang Goreng" (18.000)**, dan layanan **"Sewa Stick Premium" (10.000)** untuk billiard / **"Stik Tambahan" (5.000)** untuk PS; helper E2E `login(page, username, password)` dan `ensureShift(page)`.

- [ ] **Step 1: Tulis test seed yang gagal**

Tambahkan di `apps/server/test/seed.test.ts` dalam test `'seed menyediakan data yang dipakai E2E'`:
```ts
  const teh = await prisma.product.findUniqueOrThrow({ where: { name: 'Es Teh Manis' }, include: { category: true } });
  expect(teh).toMatchObject({ price: 8000, kind: 'STOCK', category: { name: 'Minuman' } });
  expect((await prisma.product.findUniqueOrThrow({ where: { name: 'Kopi Susu' } })).price).toBe(15000);
  expect(await prisma.product.findUnique({ where: { name: 'Sewa Stick Premium' } })).toMatchObject({ kind: 'SERVICE' });
```
dan di test PlayStation:
```ts
  expect(await prisma.product.findUnique({ where: { name: 'Stik Tambahan' } })).toMatchObject({ kind: 'SERVICE', price: 5000 });
```

Run: `pnpm --filter @funplay/server test -- seed`
Expected: FAIL — produk belum ada.

- [ ] **Step 2: Seed katalog**

Di `apps/server/src/seed-data.ts`, tambahkan konstanta:
```ts
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
```
dan di dalam transaksi `seedDemo`, setelah loop tipe unit (sebelum `return true;`):
```ts
    for (const [i, c] of [...FNB, SERVICES[outletType]].entries()) {
      const cat = await tx.category.create({ data: { name: c.name, color: c.color, sortOrder: i } });
      await tx.product.createMany({ data: c.products.map((p) => ({ ...p, categoryId: cat.id })) });
    }
```

Run: `pnpm --filter @funplay/server test -- seed`
Expected: PASS.

- [ ] **Step 3: Helper E2E & perbarui spec M1**

`e2e/helpers.ts`:
```ts
import { expect, type Page } from '@playwright/test';

export async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByTestId('unit-card-Meja 1')).toBeVisible();
}

/** Buka shift bila belum ada (DB E2E direset tiap run; shift dipakai bersama antar test). */
export async function ensureShift(page: Page) {
  const openBtn = page.getByRole('button', { name: 'Buka shift', exact: true });
  const chip = page.getByText(/^Shift: /);
  await expect(chip.or(openBtn)).toBeVisible();
  if (await openBtn.isVisible()) {
    await openBtn.click();
    await page.getByLabel('Kas awal').fill('200000');
    await page.getByRole('button', { name: 'Buka', exact: true }).click();
    await expect(chip).toBeVisible();
  }
}
```

`e2e/kasir.spec.ts`: hapus fungsi `login` lokal, import `{ ensureShift, login } from './helpers'`, dan di kedua test tambahkan `await ensureShift(page);` tepat setelah `await login(...)`.

- [ ] **Step 4: E2E transaksi**

`e2e/transaksi.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { ensureShift, login } from './helpers';

test('main, pesan minuman, Stop & Bayar split QRIS + tunai, struk di simulator', async ({ page }) => {
  await login(page, 'kasir', 'kasir123');
  await ensureShift(page);
  const card = page.getByTestId('unit-card-Meja 3');
  await card.click();
  await page.getByRole('button', { name: 'Open billing' }).click();
  await page.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');

  await page.getByRole('button', { name: '+ Pesan' }).click();
  const order = page.getByRole('dialog', { name: /Pesan · Meja 3/ });
  await order.getByRole('button', { name: /Es Teh Manis/ }).click();
  await order.getByRole('button', { name: 'Tambahkan' }).click();
  await expect(order).toBeHidden();
  await expect(page.getByTestId('bill-running-total')).toBeVisible();

  await page.getByRole('button', { name: 'Stop & Bayar' }).click();
  await page.getByRole('button', { name: 'Ya, stop & bayar' }).click();
  const pay = page.getByRole('dialog', { name: /Bayar · Meja 3/ });
  await expect(pay.getByTestId('checkout-total')).toBeVisible();
  const total = Number((await pay.getByTestId('checkout-total').innerText()).replace(/\D/g, ''));
  expect(total).toBeGreaterThan(20000);
  await pay.getByRole('button', { name: 'QRIS' }).click();
  await pay.getByLabel('Nominal').fill('20000');
  await pay.getByRole('button', { name: 'Tambah pembayaran' }).click();
  await pay.getByRole('button', { name: 'Tunai' }).click();
  await pay.getByRole('button', { name: 'Uang pas' }).click();
  await pay.getByRole('button', { name: 'Bayar', exact: true }).click();
  await expect(pay).toBeHidden();
  await expect(card).toHaveAttribute('data-status', 'IDLE');
  await expect(card).toHaveAttribute('data-light', 'off');

  await page.getByRole('button', { name: 'Struk', exact: true }).click();
  const preview = page.getByTestId('receipt-preview');
  await expect(preview).toContainText('Es Teh Manis');
  await expect(preview).toContainText('QRIS');
  await expect(preview).toContainText('TOTAL');
});

test('tagihan lepas → bayar → void dengan PIN → tutup shift', async ({ page }) => {
  await login(page, 'kasir', 'kasir123');
  await ensureShift(page);
  await page.getByRole('button', { name: '+ Transaksi baru' }).click();
  const order = page.getByRole('dialog', { name: /Pesan · Tagihan lepas/ });
  await order.getByRole('button', { name: /Kopi Susu/ }).click();
  await order.getByRole('button', { name: 'Tambahkan' }).click();
  await expect(order).toBeHidden();

  await page.getByRole('region', { name: 'Belum dibayar' }).getByRole('button', { name: /Tagihan lepas · Rp 15\.000/ }).click();
  const pay = page.getByRole('dialog', { name: /Bayar · Tagihan lepas/ });
  await pay.getByRole('button', { name: 'Uang pas' }).click();
  await pay.getByRole('button', { name: 'Bayar', exact: true }).click();
  await expect(pay).toBeHidden();

  await page.getByRole('link', { name: 'Transaksi', exact: true }).click();
  await page.getByRole('row', { name: /Tagihan lepas.*Lunas/ }).first().click();
  await page.getByRole('button', { name: 'Void', exact: true }).click();
  await page.getByLabel('Alasan').fill('salah input');
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await page.getByRole('textbox', { name: 'PIN supervisor' }).fill('1111');
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(page.getByText('Void: salah input')).toBeVisible();

  await page.getByRole('link', { name: 'Shift', exact: true }).click();
  await page.getByLabel('Kas fisik').fill('1');
  await expect(page.getByTestId('shift-difference')).not.toHaveText('Selisih: Rp 0');
  await page.getByRole('button', { name: 'Tutup shift' }).click();
  await expect(page.getByRole('button', { name: 'Buka shift', exact: true })).toBeVisible();
});
```
Catatan: tautan sidebar memakai atribut `title` (M1) sebagai nama aksesibel — "Transaksi" dan "Shift". `exact: true` diperlukan karena chip header berbunyi "Shift: …".

- [ ] **Step 5: README**

Di `README.md`, tambahkan setelah bagian "Test":
````markdown
## Fitur transaksi (M2)
- **Shift:** satu shift terbuka untuk seluruh outlet. Buka shift (kas awal) dari tombol di header; tutup dari menu Shift (kas fisik → selisih, rekap tercetak).
- **Pesanan & bayar:** di panel meja: **+ Pesan**, **Stop** (bill tetap belum dibayar), **Stop & Bayar**. Bill tanpa sesi muncul di strip "Belum dibayar". Tagihan lepas lewat **+ Transaksi baru**.
- **Checkout:** diskon item/bill, gabung bill, split payment (Tunai, QRIS, Kartu, Transfer). Diskon di atas batas, hapus item, batal, dan void butuh PIN supervisor untuk kasir.
- **Struk:** Pengaturan → *Struk & Printer*. Driver **Simulator** menampilkan struk lewat tombol **Struk** di layar; **USB** menulis ke device file di server (mis. `/dev/usb/lp0`, user server perlu akses grup `lp`); **LAN** mengirim ESC/POS ke `host:9100`. Gunakan **Tes cetak** setelah menyimpan.
- **Pajak & service:** Pengaturan → *Pajak & Service* (persen + cakupan). Urutan hitung: subtotal → diskon → service → pajak.
````

- [ ] **Step 6: Verifikasi penuh**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: semua PASS — termasuk 2 spec M1 (kini membuka shift) dan 2 spec transaksi. Tidak ada proses tersisa di port 3100.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/seed-data.ts apps/server/test/seed.test.ts e2e README.md
git commit -m "feat: demo catalog seed, transaction E2E and README"
```

---

## Cakupan spec oleh plan ini (M2)

| Spec M2 | Task |
|---|---|
| §2 keputusan: printer simulator + USB/LAN | 3, 9, 11, 14 |
| §2 satu shift outlet, shift wajib | 5, 10, 13 |
| §2 stop tanpa bayar, gabung bill | 7, 12, 13 |
| §2 kalkulator total di shared, split payment satu request | 1, 2, 8, 12 |
| §3.1 katalog | 6, 11 |
| §3.1 bill, item produk/layanan/manual, tagihan lepas | 7, 13 |
| §3.1 checkout, diskon, pajak/service, idempotency | 1, 2, 8, 12 |
| §3.1 batal, void + stok | 7, 8, 14 |
| §3.1 struk otomatis, cetak ulang, tes cetak, rekap shift | 3, 9, 14 |
| §3.1 menu Transaksi | 14 |
| §3.1 pengaturan pajak/service/batas diskon/struk/printer | 4, 11 |
| §3.2 aturan default (PIN, stok ≤ 0, tanpa pembulatan tunai) | 1, 2, 7, 8, 13 |
| §4–5 arsitektur & model data | 1–9 |
| §6 UI | 10–14 |
| §7 error handling | 5, 7, 8, 9 |
| §8 testing (unit, integrasi, web, E2E) | semua task, 15 |
| §9 review focus | 1, 8, 9 |

**Di luar M2 (sesuai spec §3.3):** saldo member & top-up, booking & DP (M3); stok masuk/penyesuaian, laporan, ekspor (M4); foto produk; QR di layar; cash drawer; printer dapur.
