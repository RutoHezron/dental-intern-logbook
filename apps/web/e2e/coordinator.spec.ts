import { expect, test, type Page } from '@playwright/test';

/**
 * Coordinator cohort view: an intern shares progress with their coordinator
 * (opt-in), the coordinator sees aggregates only, and the intern can stop
 * sharing. Runs against the test-only sync server (codes are 123456).
 */

async function signIn(page: Page, email: string) {
  await page.locator('#sync-email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel(/Code sent to/).fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('an intern shares progress with their coordinator, then stops sharing', async ({ browser }) => {
  const run = Date.now().toString(36);
  const intern = await (await browser.newContext()).newPage();
  const coordinator = await (await browser.newContext()).newPage();

  await intern.goto('/welcome');
  await intern.getByLabel('Full name').fill('Dr Share Intern');
  await intern.getByLabel('Internship training centre').fill('Test County Hospital');
  const start = await intern.evaluate(() => {
    const d = new Date(Date.now() - 28 * 86_400_000);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  await intern.getByLabel('Internship start date').fill(start);
  await intern.getByRole('button', { name: 'Create my logbook' }).click();
  await expect(intern.getByRole('heading', { level: 1 })).toContainText('Good');
  await intern.goto('/log?procedure=extraction');
  await intern.getByPlaceholder('OP-26-04417').fill('OP-26-60001');
  await intern.getByLabel('Birth year').fill('1990');
  await intern.getByRole('button', { name: 'Tooth 48' }).click();
  await intern.getByRole('radio', { name: 'Level 3: Direct supervision' }).click();
  await intern.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(intern.locator('[aria-live="polite"]').getByText(/^Saved/)).toBeVisible();

  await intern.goto('/settings');
  await signIn(intern, `share-intern-${run}@example.org`);
  await expect(intern.getByText(/Signed in as share-intern-/)).toBeVisible();
  await intern.getByRole('button', { name: 'Create a sharing code' }).click();
  await expect(intern.getByRole('img', { name: 'QR code for your coordinator' })).toBeVisible();
  const code = (await intern.getByLabel('Invite code').textContent())!.trim();

  await coordinator.goto(`/join?kind=coordinator&code=${code}`);
  await signIn(coordinator, `coordinator-${run}@example.org`);
  await coordinator.getByRole('button', { name: 'Accept invite' }).click();
  await expect(coordinator).toHaveURL(/\/cohort$/);
  const card = coordinator.getByRole('listitem', { name: 'Progress of Dr Share Intern' });
  await expect(card).toContainText('minimum entries verified');
  await expect(card).toContainText('1 awaiting verification');
  await expect(card).toContainText('Now in OMF');
  // Aggregates only: no patient number reaches the coordinator.
  await expect(coordinator.getByText('OP-26-60001')).toHaveCount(0);

  // The intern sees who can see their progress, and stops sharing.
  await intern.reload();
  await expect(intern.getByText(`coordinator-${run}@example.org`)).toBeVisible();
  await intern.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(intern.getByText(/can no longer see your progress/)).toBeVisible();
  await coordinator.getByRole('button', { name: 'Refresh' }).click();
  await expect(coordinator.getByText(/No interns share their progress with you yet/)).toBeVisible();
});
