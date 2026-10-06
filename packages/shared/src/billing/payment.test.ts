import { describe, expect, it } from 'vitest';
import { cashPayment, checkPayments } from './payment';

describe('checkPayments', () => {
  it('DP booking ditolak tanpa konteks booking', () => {
    expect(checkPayments(10000, [{ method: 'DEPOSIT', amount: 10000 }])).toMatchObject({ ok: false, code: 'PAYMENT_INVALID' });
  });
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
