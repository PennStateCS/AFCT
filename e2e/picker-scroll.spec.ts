import { test, expect } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Scrolling a picker that lives inside a dialog.
 *
 * Reported by a student: the faculty list could not be scrolled at all on a phone, and on a
 * desktop only by dragging the native scrollbar. A dialog locks scrolling through
 * react-remove-scroll and permits only its own content subtree; the picker is portalled to the
 * body, outside that subtree, so every wheel and touchmove over the list was swallowed while the
 * scrollbar, which the lock never sees, still worked.
 *
 * jsdom has no layout and no scrolling, so only a real browser can hold this. Removing `modal`
 * from the popover puts scrollTop back to 0 here, which is how the fix was confirmed.
 */
test('the faculty picker scrolls inside the create-course dialog', async ({ page }) => {
  await signIn(page, 'admin');
  await page.goto('/dashboard/courses');
  await page
    .getByRole('button', { name: /create course/i })
    .first()
    .click();

  const dialog = page.getByRole('dialog', { name: 'Create Course' });
  await expect(dialog).toBeVisible();

  // The fields ahead of the faculty step are not what this is about; fill the required ones
  // and move on.
  await dialog.getByRole('textbox', { name: /course name/i }).fill('Scroll probe');
  await dialog.getByRole('textbox', { name: /course code/i }).fill('CS 999');
  await dialog.getByRole('textbox', { name: /semester/i }).fill('Fall 2026');
  await dialog.getByRole('button', { name: 'Next' }).click();

  await expect(dialog.getByText('Step 2 of 5', { exact: false })).toBeAttached();
  // Each date field is a date box and a time box (see DateTimeField), so both halves are
  // named after the field.
  for (const field of [
    'Start Date & Time',
    'End Date & Time',
    'Self Registration Opens',
    'Self Registration Closes',
  ]) {
    await dialog.getByLabel(`${field}, date`).fill('2026-09-01');
    await dialog.getByLabel(`${field}, time`).fill('09:00');
  }
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(dialog.getByText('Step 3 of 5', { exact: false })).toBeAttached();

  await dialog.getByRole('button', { name: /assign faculty/i }).click();
  const list = page.getByRole('group', { name: 'Assign Faculty', exact: true });
  await expect(list).toBeVisible();
  // A list short enough to fit would pass the wheel assertion for the wrong reason.
  expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  await list.hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});
