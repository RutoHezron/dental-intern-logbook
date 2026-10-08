import { expect, test } from '@playwright/test';

/** On-phone storage is confirmed at first launch, and a supervisor can sign entries on the intern's phone. */

test('storage is set up on first launch, and a supervisor signs entries on the phone', async ({ page }) => {
  await page.goto('/welcome');
  await expect(page.getByText(/Storage is ready on this device/)).toBeVisible();

  await page.getByLabel('Full name').fill('Dr Signoff Intern');
  await page.getByLabel('Internship training centre').fill('Test County Hospital');
  const start = await page.evaluate(() => {
    const d = new Date(Date.now() - 28 * 86_400_000);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await page.getByLabel('Internship start date').fill(start);
  await page.getByRole('button', { name: 'Create my logbook' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good');

  // Log an extraction with a named supervisor.
  await page.goto('/log?procedure=extraction');
  await page.getByPlaceholder('OP-26-04417').fill('OP-26-80001');
  await page.getByLabel('Birth year').fill('1980');
  await page.getByRole('button', { name: 'Tooth 36' }).click();
  await page.getByRole('radio', { name: 'Level 3: Direct supervision' }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByPlaceholder('e.g. Dr J. Otieno').fill('Dr Signing Supervisor');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/sent for verification/)).toBeVisible();

  // Hand over the phone.
  await page.goto('/sign-off');
  await page.getByRole('button', { name: /Hand the phone to Dr Signing Supervisor/ }).click();
  await expect(page.getByRole('heading', { name: 'Dr Signing Supervisor, please review' })).toBeVisible();
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.getByRole('button', { name: 'Sign 1' }).click();
  await page.getByLabel('PIN', { exact: true }).fill('4071');
  await page.getByLabel('Repeat PIN').fill('4071');
  await page.getByRole('button', { name: 'Sign 1' }).click();
  await expect(page.getByText('Please hand the phone back.')).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // The entry is now verified in the logbook.
  await page.goto('/logbook');
  await expect(page.locator('main').getByTitle('OMF 2 · Verified')).toBeVisible();

  // A second sign-off needs the same PIN; a wrong one is refused.
  await page.goto('/log?procedure=extraction');
  await page.getByPlaceholder('OP-26-04417').fill('OP-26-80001');
  await page.getByRole('button', { name: 'Tooth 46' }).click();
  await page.getByRole('radio', { name: 'Level 4: Indirect supervision' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('/sign-off');
  await page.getByRole('button', { name: /Hand the phone to Dr Signing Supervisor/ }).click();
  await page.getByRole('button', { name: /Verify all remaining/ }).click();
  await page.getByRole('button', { name: 'Sign 1' }).click();
  await page.getByLabel('PIN', { exact: true }).fill('9999');
  await page.getByRole('button', { name: 'Sign 1' }).click();
  await expect(page.getByText('That PIN is not correct.')).toBeVisible();
});
