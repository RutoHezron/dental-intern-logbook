import { expect, test } from '@playwright/test';

/** Assessment forms: pre-filled, a grade of 0 or 1 requires reasons, and the printed form matches the book. */

test('complete an end-of-rotation evaluation and a monthly assessment', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Open the demo' }).click();
  await expect(page.getByText('Patients seen')).toBeVisible();

  await page.goto('/forms');
  const comm = page.locator('section', { has: page.getByRole('heading', { name: /Community Dentistry/ }) });
  await expect(comm.getByText(/Monthly assessment — month one/)).toBeVisible();
  await comm.getByRole('link', { name: /End-of-rotation evaluation/ }).click();

  await expect(page.getByRole('heading', { name: 'End-of-rotation evaluation' })).toBeVisible();
  // Community criteria differ from the clinical ones.
  await expect(page.getByText('Preparation of genogram')).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Case identification' }).getByRole('radio', { name: /^1:/ }).click();
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page.getByText(/"Case identification" is graded 1: give the reasons/).first()).toBeVisible();

  await page.getByLabel('Remarks: Case identification').fill('Missed two eligible cases; needs closer screening at clinics.');
  await page.getByRole('radiogroup', { name: 'Overall grade' }).getByRole('radio', { name: /^3:/ }).click();
  await page.getByLabel(/Internship Supervisor.s recommendation/).fill('Proceed; screening skills to be strengthened.');
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page.getByText('Form saved')).toBeVisible();

  await page.getByRole('radio', { name: 'Print view' }).click();
  const sheet = page.locator('.paper-sheet');
  await expect(sheet.getByRole('heading', { name: /5\.7\.7\.3\. End-of-Rotation Evaluation in Community Dentistry/ })).toBeVisible();
  await expect(sheet.getByText('Missed two eligible cases; needs closer screening at clinics.')).toBeVisible();
  await expect(sheet.getByText(/Attachment: logbook progress on/)).toBeVisible();

  // Monthly assessment: the supervisor's progress remark can be filled from the logbook.
  await page.goto('/forms');
  const omf = page.locator('section', { has: page.getByRole('heading', { name: /Oral and Maxillofacial Surgery/ }) });
  await omf.getByRole('link', { name: /month one/ }).click();
  await expect(page.getByLabel('2. Intern’s progress in achieving logbook targets')).toHaveValue(/As of 9 Nov 2025: minimum met for/);
});
