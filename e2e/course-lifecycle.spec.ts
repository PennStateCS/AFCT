import { expect, test } from '@playwright/test';
import { signIn, unique } from './helpers';

/**
 * Workflow 1: an admin creates a course through the wizard.
 *
 * NOT FINISHED - marked fixme so it does not report false coverage.
 *
 * What is already mapped and verified by hand (keep this, it is most of the work):
 *   - Step 1 Details: #name, #code, #semester, #credits. `semester` has no default and
 *     silently blocks Next. `code` is format-validated ("CMPSC 221" style, letters then
 *     digits) so a prefix containing a digit is rejected.
 *   - Step 2 Schedule: #startDate, #endDate, #registrationOpenAt, #registrationCloseAt,
 *     all type=datetime-local, all required, none defaulted.
 *   - Step 3 Faculty & TAs: at least one instructor required ("Pick at least one
 *     instructor."). The trigger's visible text is "Select faculty" but that is NOT its
 *     accessible name, so getByRole('button', { name: 'Select faculty' }) matches zero
 *     elements. This is the unresolved blocker: the multiselect needs a stable hook.
 *   - Step 4 Options: defaults are fine.
 *   - Step 5 Review: submit button label still unconfirmed (it is not "Next").
 *
 * The cheapest fix is probably a data-testid (or a real aria-label) on the faculty and
 * TA multiselect triggers. That is a source change, so it is left for a decision rather
 * than snuck in under a test commit.
 */
test.fixme('admin creates a course through the wizard', async ({ page }) => {
  const name = unique('E2E Course');
  const code = `TSTE ${Math.floor(Math.random() * 900 + 100)}`;

  await signIn(page, 'admin');
  await page.goto('/dashboard/courses');

  await page.getByRole('button', { name: 'Create Course' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Create Course' })).toBeVisible();

  await dialog.getByLabel('Course Name').fill(name);
  await dialog.getByLabel('Course Code').fill(code);
  await dialog.getByLabel('Semester').fill('Summer 2026');
  await dialog.getByRole('button', { name: 'Next' }).click();

  await dialog.locator('#startDate').fill('2026-08-01T09:00');
  await dialog.locator('#endDate').fill('2026-12-15T17:00');
  await dialog.locator('#registrationOpenAt').fill('2026-07-01T09:00');
  await dialog.locator('#registrationCloseAt').fill('2026-08-15T17:00');
  await dialog.getByRole('button', { name: 'Next' }).click();

  await dialog.locator('button', { hasText: 'Select faculty' }).first().click();
  await page.getByRole('option').first().click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Next' }).click();

  for (let i = 0; i < 2; i++) {
    const next = dialog.getByRole('button', { name: 'Next' });
    if (!(await next.isVisible().catch(() => false))) break;
    await next.click();
  }

  await dialog.getByRole('button', { name: /^(Create|Finish|Submit)/ }).last().click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(name)).toBeVisible({ timeout: 30_000 });
});
