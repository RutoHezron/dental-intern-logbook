import { expect, test, type Page } from '@playwright/test';

/**
 * The core promise, end to end: set up once, log a visit in seconds, and see
 * it flow into the logbook, the code progress and the reports.
 */

async function setUpOwnInternship(page: Page) {
  await page.goto('/welcome');
  await page.getByLabel('Full name').fill('Dr E2E Intern');
  await page.getByLabel('Internship training centre').fill('Test County Hospital');
  // Start four weeks ago (a Monday) so today is inside the first rotation (OMF).
  const start = await page.evaluate(() => {
    const d = new Date(Date.now() - 28 * 86_400_000);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await page.getByLabel('Internship start date').fill(start);
  await page.getByRole('button', { name: 'Create my logbook' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good');
}

test('set up, log an extraction, and see it in the logbook, codes and reports', async ({ page }) => {
  await setUpOwnInternship(page);

  // Quick entry from the dashboard favourite.
  await page.getByRole('link', { name: 'Extraction', exact: true }).click();
  await page.getByPlaceholder('OP-26-04417').fill('OP-26-70001');
  await page.getByLabel('Birth year').fill('1979');
  await page.getByRole('button', { name: 'Tooth 46' }).click();
  await page.getByRole('radio', { name: 'Level 4: Indirect supervision' }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click(); // supervisor: add inline
  await page.getByPlaceholder('e.g. Dr J. Otieno').fill('Dr E2E Supervisor');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const review = page.getByRole('region', { name: 'What this entry will log' });
  await expect(review).toContainText('Will log OMF 2 · 46');

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('1 logbook entry sent for verification')).toBeVisible();

  // Logbook: searchable by patient number, with the derived code awaiting verification.
  await page.goto('/logbook');
  await page.getByLabel('Search the logbook').fill('70001');
  await expect(page.getByText('1 record')).toBeVisible();
  await expect(page.locator('main').getByTitle('OMF 2 · Awaiting')).toBeVisible();

  // Code detail shows it as logged, not yet verified.
  await page.goto('/logbook/code/OMF%202');
  await expect(page.getByText('Awaiting verification')).toBeVisible();
  await expect(page.locator('main')).toContainText('OP-26-70001');

  // The cumulative internship report includes it.
  await page.goto('/reports/view?kind=internship');
  const procedures = page.getByRole('row', { name: /^Procedures/ });
  await expect(procedures).toContainText('1');
});

test('deleting a visit withdraws its logbook entries', async ({ page }) => {
  await setUpOwnInternship(page);
  await page.goto('/log?procedure=exam_plan');
  await page.getByPlaceholder('OP-26-04417').fill('OP-26-70002');
  await page.getByRole('radio', { name: 'Level 3: Direct supervision' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto('/logbook');
  await page.getByText('OP-26-70002').click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Visit deleted')).toBeVisible();
  await expect(page.getByText('OP-26-70002')).toHaveCount(0);
});

test('the demo internship fills the dashboard, reports and portfolio, and exports CSV', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Open the demo' }).click();
  await expect(page.getByText('fictional demo internship')).toBeVisible();
  await expect(page.getByText('Patients seen')).toBeVisible();

  await page.goto('/reports/view?kind=month&index=3');
  await expect(page.getByRole('heading', { name: 'Month 3' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Cumulative' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Logbook CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^logbook-.*\.csv$/);

  await page.goto('/portfolio');
  await expect(page.getByRole('heading', { name: 'Internship progression' })).toBeVisible();
  await expect(page.getByText('not, on their own, proof of competence')).toBeVisible();
});

test('the app opens and records a visit with no network', async ({ page, context }) => {
  await setUpOwnInternship(page);
  // Let the service worker take control, then go offline.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 }).catch(async () => {
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
  });
  await context.setOffline(true);
  await page.goto('/log?procedure=extraction');
  await page.getByPlaceholder('OP-26-04417').fill('OP-26-70003');
  await page.getByRole('button', { name: 'Tooth 36' }).click();
  await page.getByRole('radio', { name: 'Level 5: Independent' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/sent for verification/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Offline|Saved on this device/ }).first()).toBeVisible();
  await context.setOffline(false);
});
