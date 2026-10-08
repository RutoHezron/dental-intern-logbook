import { expect, test } from '@playwright/test';

/** Phone-sized checks: no sideways scrolling, and touch targets large enough to use one-handed. */

const PAGES = ['/', '/log', '/logbook', '/logbook?view=codes', '/diary', '/reports', '/reports/view?kind=month&index=2', '/competencies', '/portfolio', '/rotations', '/settings'];

test.beforeEach(async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Open the demo' }).click();
  await expect(page.getByText('Patients seen')).toBeVisible();
});

for (const path of PAGES) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('tooth and level targets are at least 40px tall on a phone', async ({ page }) => {
  await page.goto('/log?procedure=extraction');
  const tooth = await page.getByRole('button', { name: 'Tooth 46' }).boundingBox();
  const level = await page.getByRole('radio', { name: 'Level 1: Observed' }).boundingBox();
  expect(tooth!.height).toBeGreaterThanOrEqual(40);
  expect(tooth!.width).toBeGreaterThanOrEqual(30);
  expect(level!.height).toBeGreaterThanOrEqual(44);
});
