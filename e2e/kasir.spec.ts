import { expect, test } from '@playwright/test';
import { ensureShift, login } from './helpers';

test('kasir menjalankan dan menghentikan meja (open billing)', async ({ page }) => {
  await login(page, 'kasir', 'kasir123');
  await ensureShift(page);
  const card = page.getByTestId('unit-card-Meja 1');
  await expect(card).toHaveAttribute('data-status', 'IDLE');
  await card.click();
  await page.getByRole('button', { name: 'Open billing' }).click();
  await page.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');
  await expect(card).toHaveAttribute('data-light', 'on');

  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Ya, stop' }).click();
  await expect(card).toHaveAttribute('data-status', 'IDLE');
  await expect(card).toHaveAttribute('data-light', 'off');
});

test('kasir memulai paket lalu pause dengan PIN supervisor', async ({ page }) => {
  await login(page, 'kasir', 'kasir123');
  await ensureShift(page);
  const card = page.getByTestId('unit-card-Meja 2');
  await card.click();
  await page.getByRole('button', { name: 'Paket', exact: true }).click();
  await page.getByRole('button', { name: /Paket 2 Jam Reguler/ }).click();
  await page.getByRole('button', { name: 'Mulai', exact: true }).click();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('textbox', { name: 'PIN supervisor' }).fill('1111');
  await page.getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(card).toHaveAttribute('data-status', 'PAUSED');

  await page.getByRole('button', { name: 'Lanjutkan' }).click();
  await expect(card).toHaveAttribute('data-status', 'RUNNING');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Ya, stop' }).click();
  await expect(card).toHaveAttribute('data-status', 'IDLE');
});
