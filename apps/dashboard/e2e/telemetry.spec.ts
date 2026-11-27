import { expect, test } from '@playwright/test';
import { collectPageErrors } from './helpers';

let errors: string[] = [];
test.beforeEach(({ page }) => {
  errors = collectPageErrors(page);
});
test.afterEach(() => {
  // No CSP violation, hydration error or crash on any page.
  expect(errors).toEqual([]);
});

test('users are counted per segment and filtered by segment', async ({ page }) => {
  await page.goto('/users');
  const segments = page.getByRole('region').or(page.locator('section')).filter({
    hasText: 'Users by segment',
  });
  await expect(page.getByText('Users by segment')).toBeVisible();
  for (const [label, count] of [
    ['KYC', '2'],
    ['KYA', '1'],
    ['MERCHANT', '1'],
    ['FTTH', '1'],
  ]) {
    await expect(
      segments.getByRole('link', { name: new RegExp(`^${label}\\s+${count}\\s+users?`) }),
    ).toBeVisible();
  }
  await expect(page.getByRole('cell', { name: /231880000004/ })).toBeVisible();

  await segments.getByRole('link', { name: /^MERCHANT/ }).click();
  await expect(page).toHaveURL(/segment=merchant/);
  await expect(page.getByRole('heading', { name: 'Active users · MERCHANT' })).toBeVisible();
  const rows = page.locator('table tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('231880000004');
});

test('sessions show the user phone and segment, and open with request traces', async ({ page }) => {
  await page.goto('/sessions');
  const row = page.locator('table tbody tr').filter({ hasText: '231770000001' });
  await expect(row).toBeVisible();
  // Rendered uppercase by CSS; the text itself is the segment as sent.
  await expect(row.getByText('kyc', { exact: true })).toBeVisible();
  await expect(row).toContainText('kyc:231770000001');
  // A session started anonymous (0.2 SDK) is linked to its user by later items.
  await expect(
    page.locator('table tbody tr').filter({ hasText: 'kya:231880000003' }),
  ).toBeVisible();

  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/sessions\/\d+/);
  await expect(page.getByText('Phone (MSISDN)')).toBeVisible();

  const failure = page.locator('details').filter({ hasText: '/agent/statistics' });
  await failure.locator('summary').click();
  await expect(failure.getByText('Unable to resolve host "kyc.example.lr"')).toBeVisible();
  await expect(failure.getByText('None: the API never answered this request.')).toBeVisible();
});

test('network traces tell an API error from a network failure', async ({ page }) => {
  await page.goto('/performance?tab=network');
  await expect(page.getByRole('combobox', { name: 'Auto-refresh interval' })).toContainText(
    'Every 5 minutes',
  );

  const endpoint = page.locator('table tbody tr').filter({ hasText: '/customers/add' });
  await endpoint.getByRole('button', { name: 'View' }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Latest traces (5)')).toBeVisible();
  // Closed traces keep their content in the DOM: scope to the one opened.
  const trace = sheet.locator('details').first();
  await trace.locator('summary').click();
  await expect(trace.getByText('422 Unprocessable Content')).toBeVisible();
  await expect(trace.getByText('"MSISDN already registered"')).toBeVisible();
  await expect(trace.getByText(/^4bf92f3577b34da6a3ce929d0e0e47\d\d$/)).toBeVisible();
  await page.keyboard.press('Escape');

  const recent = page.locator('details').filter({ hasText: '/agent/statistics' }).first();
  await recent.locator('summary').click();
  await expect(recent.getByText('Network error').first()).toBeVisible();
});

test('an issue opens with its stack and can be resolved', async ({ page }) => {
  await page.goto('/issues');
  await page
    .getByRole('link', { name: /TypeError/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/issues\/[0-9a-f-]+/);
  await expect(page.getByText("Cannot read property 'msisdn' of undefined").first()).toBeVisible();
  await expect(page.getByText('submitCustomer').first()).toBeVisible();

  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByRole('button', { name: 'Resolve' })).toBeVisible();
});
