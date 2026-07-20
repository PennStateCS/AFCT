import { expect, test } from '@playwright/test';
import { signIn, USERS } from './helpers';

test.describe('sign in', () => {
  test('admin signs in and reaches the dashboard', async ({ page }) => {
    await signIn(page, 'admin');
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('bad password is rejected and does not create a session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(USERS.admin.email);
    await page.getByLabel('Password', { exact: true }).fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Still on the login page, with an error.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/incorrect|locked/i).first()).toBeVisible();

    // The important half: a rejected sign-in must not leave a usable session behind.
    // Asserting only on the error message would pass even if the cookie were set.
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('signed-out users cannot reach the dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});
