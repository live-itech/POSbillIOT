import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, username: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
  await expect(page.getByTestId('unit-card-Meja 1')).toBeVisible();
}

test('kasir menjalankan dan menghentikan meja (open billing)', async ({ page }) => {
  await login(page, 'kasir', 'kasir123');
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
