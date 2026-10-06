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
