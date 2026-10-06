import type { PaymentMethod } from '../transactions';

export interface PaymentInput {
  method: PaymentMethod;
  /** Bagian tagihan yang ditutup metode ini. */
  amount: number;
  /** Tunai: uang yang diserahkan pelanggan (≥ amount; kosong = uang pas). DEPOSIT: DP booking utuh. */
  received?: number | null;
  reference?: string | null;
}
export interface CheckedPayment { method: PaymentMethod; amount: number; received: number | null; change: number | null; reference: string | null }
export interface PaymentCheckOptions {
  /** DP booking yang tersedia untuk bill ini; kosong/0 = metode DEPOSIT tidak boleh dipakai. */
  deposit?: number | null;
}
export type PaymentCheck =
  | { ok: true; paid: number; change: number; depositChange: number; payments: CheckedPayment[] }
  | { ok: false; code: 'PAYMENT_INSUFFICIENT' | 'PAYMENT_INVALID'; message: string };

const invalid = (message: string): PaymentCheck => ({ ok: false, code: 'PAYMENT_INVALID', message });
const isPositiveInt = (n: number) => Number.isInteger(n) && n > 0;

/**
 * Validasi split payment. DEPOSIT (DP booking) hanya sah bila `opts.deposit` > 0, dipakai sekali,
 * dengan `amount = min(DP, total)` dan `received = DP`; kelebihannya menjadi `depositChange`
 * (dikembalikan tunai). `change` hanya kembalian dari pembayaran CASH.
 */
export function checkPayments(grandTotal: number, payments: PaymentInput[], opts: PaymentCheckOptions = {}): PaymentCheck {
  const checked: CheckedPayment[] = [];
  for (const p of payments) {
    if (!isPositiveInt(p.amount)) return invalid('Nominal pembayaran harus bilangan bulat lebih dari 0');
    const reference = p.reference?.trim() || null;
    if (p.method === 'DEPOSIT') {
      const dp = opts.deposit ?? 0;
      if (dp <= 0) return invalid('DP booking tidak tersedia untuk bill ini');
      if (checked.some((c) => c.method === 'DEPOSIT')) return invalid('DP booking hanya bisa dipakai sekali');
      const received = p.received ?? dp;
      if (received !== dp || p.amount !== Math.min(dp, grandTotal)) return invalid('Nominal DP booking tidak sesuai');
      checked.push({ method: 'DEPOSIT', amount: p.amount, received, change: received - p.amount, reference: null });
      continue;
    }
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
  const changeOf = (m: PaymentMethod) => checked.filter((c) => c.method === m).reduce((a, c) => a + (c.change ?? 0), 0);
  return { ok: true, paid, change: changeOf('CASH'), depositChange: changeOf('DEPOSIT'), payments: checked };
}

/** Tunai yang diserahkan pelanggan → bagian tagihan yang ditutup (sisanya jadi kembalian). */
export function cashPayment(remaining: number, received: number): PaymentInput {
  return { method: 'CASH', amount: Math.min(received, remaining), received };
}
