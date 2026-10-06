import type { ChargeLine } from './billing/charge';
import type { SessionView } from './views';
import type { BillMemberView } from './members';

export const PAYMENT_METHODS = ['CASH', 'QRIS', 'CARD', 'TRANSFER', 'DEPOSIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = { CASH: 'Tunai', QRIS: 'QRIS', CARD: 'Kartu', TRANSFER: 'Transfer', DEPOSIT: 'DP booking' };
/** Metode yang bisa dipilih kasir. DEPOSIT hanya diisi otomatis dari DP booking. */
export const MANUAL_PAYMENT_METHODS = ['CASH', 'QRIS', 'CARD', 'TRANSFER'] as const satisfies readonly PaymentMethod[];

export const BILL_STATUSES = ['OPEN', 'PAID', 'VOID', 'CANCELLED'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
export const BILL_STATUS_LABEL: Record<BillStatus, string> = { OPEN: 'Belum dibayar', PAID: 'Lunas', VOID: 'Void', CANCELLED: 'Dibatalkan' };

export const LINE_TYPES = ['TIME', 'PRODUCT', 'SERVICE', 'CUSTOM', 'DEPOSIT'] as const;
export type LineType = (typeof LINE_TYPES)[number];

/** SALE = bill penjualan biasa; DEPOSIT = bill DP booking (satu baris DEPOSIT). */
export const BILL_KINDS = ['SALE', 'DEPOSIT'] as const;
export type BillKind = (typeof BILL_KINDS)[number];

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
  kind: BillKind;
  /** Snapshot member saat dipasang (diskon level ikut di-snapshot). */
  member: BillMemberView | null;
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
  kind: BillKind;
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
