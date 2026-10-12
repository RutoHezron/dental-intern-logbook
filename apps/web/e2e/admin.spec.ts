import { expect, test, type Page } from '@playwright/test';

/**
 * Administrator route, end to end with three browsers: an intern syncs a
 * logbook entry submitted to "Dr Linked Sup"; the administrator registers that
 * supervisor by email and links them to the intern (no invite code); the
 * supervisor signs in and sees the request and the intern's activity.
 * Runs against the test-only sync server, where admin@test.example is an administrator.
 */

async function signIn(page: Page, email: string) {
  await page.locator('#sync-email').fill(email);
  await page.getByRole('button', { name: 'Email me a code' }).click();
  await page.getByLabel(/Code sent to/).fill('123456');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('an administrator links a supervisor to an intern directly', async ({ browser }) => {
  const run = Date.now().toString(36);
  const intern = await (await browser.newContext()).newPage();
  const admin = await (await browser.newContext()).newPage();
  const supervisor = await (await browser.newContext()).newPage();
  const internName = `Dr Admin Intern ${run}`;
  const supEmail = `linked-${run}@hospital.example`;

  // Intern: one extraction submitted to "Dr Linked Sup", synced.
  await intern.goto('/welcome');
  await intern.getByLabel('Full name').fill(internName);
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
  await intern.getByPlaceholder('OP-26-04417').fill('OP-26-70002');
  await intern.getByLabel('Birth year').fill('1981');
  await intern.getByRole('button', { name: 'Tooth 48' }).click();
  await intern.getByRole('radio', { name: 'Level 3: Direct supervision' }).click();
  await intern.getByRole('button', { name: 'New', exact: true }).click();
  await intern.getByPlaceholder('e.g. Dr J. Otieno').fill('Dr Linked Sup');
  await intern.getByRole('button', { name: 'Add', exact: true }).click();
  await intern.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(intern.getByText(/sent for verification/)).toBeVisible();
  await intern.goto('/settings');
  await signIn(intern, `admin-intern-${run}@example.org`);
  await expect(intern.getByText(/Signed in as admin-intern-/)).toBeVisible();

  // Not an administrator: refused.
  await supervisor.goto('/admin');
  await signIn(supervisor, supEmail);
  await expect(supervisor.getByText(`${supEmail} is not an administrator`)).toBeVisible();

  // Administrator: register the supervisor, then link them to the intern.
  await admin.goto('/admin');
  await signIn(admin, 'admin@test.example');
  await admin.getByRole('radio', { name: /Supervisors/ }).click();
  await admin.getByLabel('Full name').fill('Dr Linked Sup');
  await admin.getByLabel(/^Email/).fill(supEmail);
  await admin.getByRole('button', { name: 'Register' }).click();
  await expect(admin.getByText('Dr Linked Sup registered')).toBeVisible();
  await expect(admin.getByText(supEmail)).toBeVisible();

  await admin.getByRole('radio', { name: /Interns/ }).click();
  await admin.getByLabel('Search interns').fill(run);
  const card = admin.getByRole('listitem', { name: internName });
  await card.getByLabel('Link a supervisor').selectOption({ label: `Dr Linked Sup (${supEmail})` });
  // The intern's own record of the same name is suggested.
  await expect(card.getByLabel('As')).toHaveValue(/^(?!new$)/);
  await card.getByRole('button', { name: 'Link', exact: true }).click();
  await expect(admin.getByText(`Dr Linked Sup now supervises ${internName}`)).toBeVisible();
  await expect(card).toContainText(`Linked to ${supEmail}`);

  // Supervisor: the request and the activity, without any code.
  await supervisor.goto('/supervise');
  const queue = supervisor.getByRole('region', { name: `Queue for ${internName}` });
  await expect(queue).toContainText('OP-26-70002');
  await supervisor.getByRole('radio', { name: 'Activity' }).click();
  const activity = supervisor.getByRole('region', { name: `Activity of ${internName}` });
  await expect(activity).toContainText('Waiting for you');
  await expect(activity).not.toContainText('OP-26-70002');

  // Intern: the link shows on their phone after a sync.
  await intern.getByRole('button', { name: 'Sync now' }).click();
  await intern.goto('/rotations');
  await expect(intern.getByText('Signs from own phone')).toBeVisible();
});
