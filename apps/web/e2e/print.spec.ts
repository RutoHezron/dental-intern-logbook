import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

/** KMPDC paper pages render, follow the book's structure, and print to a multi-page A4 PDF. */

test('prints the oral surgery and community logbook pages', async ({ page }) => {
  await page.goto('/welcome');
  await page.getByRole('button', { name: 'Open the demo' }).click();
  await expect(page.getByText('Patients seen')).toBeVisible();

  await page.goto('/print');
  await page.getByLabel('Rotation').selectOption({ label: 'Oral and Maxillofacial Surgery' });
  const sheet = page.locator('.paper-sheet');
  await expect(sheet.getByRole('heading', { name: '5.3. ORAL AND MAXILLOFACIAL SURGERY ROTATION' })).toBeVisible();
  await expect(sheet.getByText('Dr Alex Mwangi')).toBeVisible();
  await expect(sheet.getByText(/^OMF1: Oral diagnosis/)).toBeVisible();
  await expect(sheet.getByText(/^OMF19: Postmortem examination/)).toBeVisible();
  await expect(sheet.getByRole('heading', { name: '5.3.5. Log of Case Reports' })).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Digital verification record' })).toBeVisible();
  // OMF 2 has 20 printed rows in the book; extra verified extractions go to a continuation sheet.
  await expect(sheet.getByText(/^Continuation sheet — OMF2/)).toBeVisible();

  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  if (process.env.SAVE_PDF) writeFileSync(process.env.SAVE_PDF, pdf);
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBeGreaterThan(10);
  await page.emulateMedia({ media: 'screen' });

  await page.getByLabel('Rotation').selectOption({ label: 'Community Dentistry' });
  await expect(sheet.getByRole('heading', { name: '5.7.4. Log of Community Dentistry activities' })).toBeVisible();
  await expect(sheet.getByText('Diabetes case follow-up')).toBeVisible();
  await expect(sheet.getByRole('heading', { name: '5.7.6. Log of Weekly Reports on Community Dentistry activities' })).toBeVisible();
});
