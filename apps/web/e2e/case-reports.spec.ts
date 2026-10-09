import { expect, test } from '@playwright/test';

/** Write a case report from a visit, send it, have the supervisor verify it on the phone. */

test('case report: drafted from a visit, verified on the phone, listed as verified', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Open the demo' }).click();
  await expect(page.getByText('Patients seen')).toBeVisible();

  // Open a recent visit in the current rotation and start a case report from it.
  await page.goto('/logbook?rotation=COMM');
  await page.locator('main a[href^="/log/visit/"]').first().click();
  await page.getByRole('link', { name: 'Write a case report' }).click();

  const title = page.getByLabel('Case description (printed in the logbook)');
  await expect(title).not.toHaveValue('');
  await expect(page.getByLabel(/^Diagnosis/)).not.toHaveValue('');
  await expect(page.getByLabel(/^Management/)).toHaveValue(/performed/);
  // The hospital number is never copied into the report.
  await expect(page.getByLabel(/^Presenting complaint/)).not.toHaveValue(/OP-\d/);

  await page.getByLabel(/^Discussion and learning points/).fill('Outreach screening found untreated disease; follow-up must be arranged before leaving the site.');
  const supervisor = (await page.locator('#cr-sup option:checked').textContent())!.split(' · ')[0]!.trim();
  const reportTitle = `${await title.inputValue()} at outreach screening`;
  await title.fill(reportTitle);
  await page.getByRole('button', { name: 'Send for verification' }).click();
  await expect(page.getByText('Sent to your supervisor for verification')).toBeVisible();

  // Supervisor sign-off on the phone.
  await page.goto('/sign-off');
  await page.getByRole('button', { name: new RegExp(`Hand the phone to ${supervisor}`) }).click();
  const card = page.getByRole('group', { name: `Decision for case report ${reportTitle}` });
  await card.getByRole('button', { name: 'Verify' }).click();
  await page.getByRole('button', { name: 'Sign 1' }).click();
  await page.getByLabel('PIN', { exact: true }).fill('4071');
  await page.getByLabel('Repeat PIN').fill('4071');
  await page.getByRole('button', { name: 'Sign 1' }).click();
  await expect(page.getByText('Please hand the phone back.')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.goto('/case-reports');
  const row = page.getByRole('link', { name: new RegExp(reportTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first();
  await expect(row).toContainText('Verified');
});
