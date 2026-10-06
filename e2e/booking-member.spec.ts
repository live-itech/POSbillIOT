import { expect, test, type Locator } from '@playwright/test';
import { ensureShift, login } from './helpers';

const rupiah = async (l: Locator) => Number((await l.innerText()).replace(/\D/g, ''));

test('member Gold: diskon member otomatis saat Stop & Bayar', async ({ page }) => {
  await login(page, 'supervisor', 'super123');
  await ensureShift(page);

  await page.getByRole('link', { name: 'Member', exact: true }).click();
  await page.getByRole('button', { name: 'Level', exact: true }).click();
  await page.getByRole('button', { name: 'Tambah' }).click();
  const lv = page.getByRole('dialog', { name: 'Tambah Level' });
  await lv.getByLabel('Nama').fill('Gold');
  await lv.getByLabel('Diskon billing (%)').fill('10');
  await lv.getByLabel('Diskon FnB (%)').fill('0');
  await lv.getByRole('button', { name: 'Simpan' }).click();
  await expect(lv).toBeHidden();

  await page.getByRole('button', { name: 'Member', exact: true }).click();
  await page.getByRole('button', { name: '+ Member' }).click();
  const md = page.getByRole('dialog', { name: 'Tambah member' });
  await md.getByLabel('Nama').fill('Sinta');
  await md.getByLabel('No. HP').fill('081234567890');
  await md.getByLabel('Level').selectOption({ label: 'Gold' });
  await md.getByRole('button', { name: 'Simpan' }).click();
  await expect(md).toBeHidden();
  await expect(page.getByRole('row', { name: /M0001.*Sinta.*Gold/ })).toBeVisible();

  await page.getByRole('link', { name: 'Meja', exact: true }).click();
  const card = page.getByTestId('unit-card-Meja 5');
  await card.click();
  await page.getByRole('button', { name: 'Pilih member' }).click();
  const picker = page.getByRole('dialog', { name: 'Pilih member' });
  await picker.getByLabel('Cari member').fill('Sinta');
  await picker.getByRole('button', { name: /Sinta/ }).click();
  await expect(page.getByText('Member: Sinta (Gold)')).toBeVisible();
  await page.getByRole('button', { name: 'Open billing' }).click();
  await page.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');

  await page.getByRole('button', { name: '+ Pesan' }).click();
  const order = page.getByRole('dialog', { name: /Pesan · Meja 5/ });
  await order.getByRole('button', { name: /Es Teh Manis/ }).click();
  await order.getByRole('button', { name: 'Tambahkan' }).click();
  await expect(order).toBeHidden();

  await page.getByRole('button', { name: 'Stop & Bayar' }).click();
  await page.getByRole('button', { name: 'Ya, stop & bayar' }).click();
  const pay = page.getByRole('dialog', { name: /Bayar · Meja 5/ });
  await expect(pay.getByText('Member: Sinta (Gold)')).toBeVisible();
  await expect(pay.getByTestId('checkout-member-discount')).toBeVisible();
  const subtotal = await rupiah(pay.getByTestId('checkout-subtotal'));
  const discount = await rupiah(pay.getByTestId('checkout-member-discount'));
  const total = await rupiah(pay.getByTestId('checkout-total'));
  // diskon billing 10% hanya atas biaya waktu (subtotal − Es Teh 8.000); FnB 0%
  expect(discount).toBe(Math.round(((subtotal - 8000) * 10) / 100));
  expect(total).toBe(subtotal - discount);
  await pay.getByRole('button', { name: 'Uang pas' }).click();
  await pay.getByRole('button', { name: 'Bayar', exact: true }).click();
  await expect(pay).toBeHidden();
  await expect(card).toHaveAttribute('data-status', 'IDLE');
});

test('booking dengan DP tunai → Booked → Check-in → DP terpakai saat bayar', async ({ page }) => {
  await login(page, 'kasir', 'kasir123');
  await ensureShift(page);

  await page.getByRole('link', { name: 'Booking', exact: true }).click();
  await page.getByRole('button', { name: '+ Booking' }).click();
  const dlg = page.getByRole('dialog', { name: 'Booking baru' });
  // jadwal = sekarang + 10 menit, jam lokal outlet (seed: UTC+7)
  const local = new Date(Date.now() + 10 * 60_000 + 420 * 60_000).toISOString();
  await dlg.getByLabel('Meja').selectOption({ label: 'Meja 4' });
  await dlg.getByLabel('Tanggal').fill(local.slice(0, 10));
  await dlg.getByLabel('Jam').fill(local.slice(11, 16));
  await dlg.getByRole('button', { name: '60 mnt' }).click();
  await dlg.getByLabel('Nama pelanggan').fill('Budi');
  await dlg.getByLabel('No. HP').fill('0812000111');
  await dlg.getByLabel('DP (Rp)').fill('50000');
  await dlg.getByRole('button', { name: 'Simpan booking' }).click();

  const dp = page.getByRole('dialog', { name: /Bayar · DP · Budi · Meja 4/ });
  await expect(dp.getByTestId('checkout-total')).toHaveText('Rp 50.000');
  await dp.getByRole('button', { name: 'Uang pas' }).click();
  await dp.getByRole('button', { name: 'Bayar', exact: true }).click();
  await expect(dp).toBeHidden();

  await page.getByRole('link', { name: 'Meja', exact: true }).click();
  const card = page.getByTestId('unit-card-Meja 4');
  await expect(card).toHaveAttribute('data-booked', 'true');
  await expect(card).toContainText('Booked · Budi');
  await expect(card).toContainText('💰');
  await card.click();
  await page.getByRole('button', { name: 'Check-in', exact: true }).click();
  const ci = page.getByRole('dialog', { name: 'Check-in · Budi' });
  await ci.getByRole('button', { name: 'Open billing' }).click();
  await ci.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(ci).toBeHidden();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');

  await page.getByRole('button', { name: '+ Pesan' }).click();
  const order = page.getByRole('dialog', { name: /Pesan · Meja 4/ });
  await order.getByRole('button', { name: /Kopi Susu/ }).click();
  await order.getByRole('button', { name: 'Tambahkan' }).click();
  await expect(order).toBeHidden();

  await page.getByRole('button', { name: 'Stop & Bayar' }).click();
  await page.getByRole('button', { name: 'Ya, stop & bayar' }).click();
  const pay = page.getByRole('dialog', { name: /Bayar · Meja 4/ });
  await expect(pay.getByTestId('checkout-deposit')).toHaveText('Rp 50.000');
  const total = await rupiah(pay.getByTestId('checkout-total'));
  expect(total).toBeGreaterThan(50000); // waktu minimum 60 menit + Kopi Susu 15.000
  await expect(pay.getByTestId('checkout-remaining')).toHaveText(`Rp ${(total - 50000).toLocaleString('id-ID')}`);
  await pay.getByRole('button', { name: 'Tunai' }).click();
  await pay.getByRole('button', { name: 'Uang pas' }).click();
  await pay.getByRole('button', { name: 'Bayar', exact: true }).click();
  await expect(pay).toBeHidden();

  await page.getByRole('link', { name: 'Booking', exact: true }).click();
  const item = page.getByRole('list', { name: 'Booking hari ini' }).getByRole('listitem').filter({ hasText: 'Budi' });
  await expect(item).toContainText('Check-in');
  await expect(item).toContainText('DP terpakai');
});
