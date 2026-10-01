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
