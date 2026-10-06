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
