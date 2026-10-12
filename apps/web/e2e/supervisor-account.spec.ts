import { expect, test, type Page } from '@playwright/test';

/**
 * Supervisor accounts, end to end with two browsers: the intern invites their
 * supervisor; the supervisor accepts on their own device, reviews and signs;
 * the intern's next sync shows the entry verified. Runs against the test-only
 * sync server (real migrations in PGlite; every email code is 123456).
 */

async function signIn(page: Page, email: string, button = 'Sign in') {
  await page.locator('#sync-email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel(/Code sent to/).fill('123456');
  await page.getByRole('button', { name: button }).click();
}

test('an intern invites a supervisor, who verifies from their own device', async ({ browser }) => {
  const run = Date.now().toString(36);
  const intern = await (await browser.newContext()).newPage();
  const supervisor = await (await browser.newContext()).newPage();

  // Intern: logbook, one extraction submitted to a named supervisor.
  await intern.goto('/welcome');
  await intern.getByLabel('Full name').fill('Dr Remote Intern');
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
  await intern.getByPlaceholder('OP-26-04417').fill('OP-26-70001');
  await intern.getByLabel('Birth year').fill('1979');
  await intern.getByRole('button', { name: 'Tooth 38' }).click();
  await intern.getByRole('radio', { name: 'Level 3: Direct supervision' }).click();
  await intern.getByRole('button', { name: 'New', exact: true }).click();
  await intern.getByPlaceholder('e.g. Dr J. Otieno').fill('Dr Remote Sup');
  await intern.getByRole('button', { name: 'Add', exact: true }).click();
  await intern.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(intern.getByText(/sent for verification/)).toBeVisible();

  // Intern signs in so the logbook reaches the server, then invites.
  await intern.goto('/settings');
  await signIn(intern, `intern-${run}@example.org`);
  await expect(intern.getByText(/Signed in as intern-/)).toBeVisible();
  await intern.goto('/rotations');
  await intern.getByRole('button', { name: 'Invite Dr Remote Sup to sign from their own phone' }).click();
  await expect(intern.getByRole('img', { name: /QR code for Dr Remote Sup/ })).toBeVisible();
  const code = (await intern.getByLabel('Invite code').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  // Supervisor, on their own device: open the link, sign in, accept.
  await supervisor.goto(`/join?code=${code}`);
  await signIn(supervisor, `supervisor-${run}@example.org`);
  await expect(supervisor.getByLabel('Invite code')).toHaveValue(code);
  await supervisor.getByRole('button', { name: 'Accept invite' }).click();
  await expect(supervisor).toHaveURL(/\/supervise$/);

  const queue = supervisor.getByRole('region', { name: 'Queue for Dr Remote Intern' });
  await expect(queue).toContainText('OP-26-70001');
  await expect(queue).toContainText('you are listed as Dr Remote Sup');
  await queue.getByRole('button', { name: /Verify all remaining/ }).click();
  await queue.getByRole('button', { name: /^Sign \d/ }).click();
  await queue.getByRole('button', { name: 'Confirm and sign' }).click();
  await expect(supervisor.getByText(/signed for Dr Remote Intern/)).toBeVisible();
  await expect(queue).toContainText('Nothing from Dr Remote Intern is waiting for you.');

  // Intern: the next sync brings the verification home.
  await intern.goto('/settings');
  await intern.getByRole('button', { name: 'Sync now' }).click();
  await intern.goto('/logbook');
  await expect(intern.locator('main').getByTitle('OMF 2 · Verified')).toBeVisible();
  await intern.goto('/rotations');
  await expect(intern.getByText('Signs from own phone')).toBeVisible();
});

test("a phone holding an intern's logbook cannot be used for supervisor sign-in", async ({ page }) => {
  await page.goto('/welcome');
  await page.getByLabel('Full name').fill('Dr Phone Owner');
  await page.getByLabel('Internship training centre').fill('Test County Hospital');
  await page.getByLabel('Internship start date').fill('2026-01-05');
  await page.getByRole('button', { name: 'Create my logbook' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.goto('/supervise');
  await expect(page.getByText(/This device holds Dr Phone Owner's logbook/)).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
});
