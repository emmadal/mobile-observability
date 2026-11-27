import { expect, test } from '@playwright/test';
import { collectPageErrors, readSeed } from './helpers';

// Starts signed out, independent of the stored owner session.
test.use({ storageState: { cookies: [], origins: [] } });

test('redirects to login and rejects a wrong password', async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.goto('/sessions');
  await expect(page).toHaveURL(/\/login\?next=%2Fsessions/);

  await page.getByLabel('Email').fill(readSeed().email);
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('alert').or(page.locator('[id$="-error"]')).first()).toBeVisible();
  expect(errors.filter((error) => !/401|400|Failed to load resource/.test(error))).toEqual([]);
});

test('signs in, then signs out after confirming', async ({ page }) => {
  const seed = readSeed();
  const errors = collectPageErrors(page);
  await page.goto('/login');
  await page.getByLabel('Email').fill(seed.email);
  await page.getByLabel('Password').fill(seed.password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);

  await page.getByRole('button', { name: 'Sign out' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText('Sign out?')).toBeVisible();
  await dialog.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect(errors).toEqual([]);
});
