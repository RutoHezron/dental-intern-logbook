import { expect, test } from '@playwright/test';

/** Plan multi-visit care, see the brief before the next visit, record progress by logging, hand over. */

test('treatment plan: plan, brief, progress from a logged visit, handover', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByLabel('Full name').fill('Dr Plan Intern');
  await page.getByLabel('Internship training centre').fill('Test County Hospital');
  const start = await page.evaluate(() => {
    const d = new Date(Date.now() - 28 * 86_400_000);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await page.getByLabel('Internship start date').fill(start);
  await page.getByRole('button', { name: 'Create my logbook' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Good');

  // First visit: start a root canal on 46.
  await page.goto('/log?procedure=rct');
  await page.getByPlaceholder('OP-26-04417').fill('OP-26-90001');
  await page.getByLabel('Birth year').fill('1985');
  await page.getByRole('button', { name: 'Tooth 46' }).click();
  await page.getByRole('radio', { name: 'Level 4: Indirect supervision' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('[aria-live="polite"]').getByText(/^Saved/)).toBeVisible();

  // Open the patient's case timeline and agree a plan.
  await page.goto('/log');
  await page.getByPlaceholder('OP-26-04417').fill('OP-26-90001');
  await page.getByRole('link', { name: 'case timeline and plan' }).click();
  await page.getByRole('button', { name: 'Create plan' }).click();
  await page.getByLabel('Treatment', { exact: true }).selectOption({ label: 'Root canal treatment' });
  await page.getByRole('button', { name: 'Tooth 46' }).click();
  await page.getByRole('button', { name: 'Add to plan' }).click();
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByText('Plan saved')).toBeVisible();
  await expect(page.locator('section', { has: page.getByRole('heading', { name: 'Treatment plan' }) })).toContainText('Next: RCT 46');

  // Next visit: the brief shows, and logging stage 2 updates the plan.
  await page.getByRole('link', { name: 'Log a visit for this patient' }).click();
  await expect(page.getByRole('region', { name: 'Next-visit brief' })).toContainText('Planned next: RCT 46');
  await page.getByRole('button', { name: 'RCT', exact: true }).click();
  await page.getByRole('button', { name: 'Tooth 46' }).click();
  await page.getByRole('radio', { name: '2. Cleaning & shaping' }).click();
  await page.getByRole('radio', { name: 'Level 4: Indirect supervision' }).click();
  await expect(page.getByRole('region', { name: 'What this entry will log' })).toContainText('RCT 46: stage 2 of 3 done (Cleaning & shaping); next: Obturation');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/treatment plan updated/)).toBeVisible();

  // Handover before leaving the rotation.
  await page.goto('/handover');
  await expect(page.getByText('OP-26-90001')).toBeVisible();
  await expect(page.getByText(/RCT 46 — stage 2 of 3 done/)).toBeVisible();
  await page.getByLabel('Handover note for OP-26-90001').fill('Calcium hydroxide dressing in place; obturate at next visit.');
  await page.getByLabel('Receiving intern for OP-26-90001').fill('Dr Next Intern');
  await page.getByRole('button', { name: 'Save handover' }).click();
  await expect(page.getByText('Handover saved', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Print view' }).click();
  await expect(page.locator('.paper-sheet')).toContainText('Calcium hydroxide dressing in place; obturate at next visit.');
});
