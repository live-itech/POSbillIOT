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
    if (p.method === 'DEPOSIT') return invalid('DP booking tidak tersedia untuk bill ini');
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
