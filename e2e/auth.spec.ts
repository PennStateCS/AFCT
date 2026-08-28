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

  /**
   * The login page is a fixed light composition, so a dashboard theme left in localStorage
   * must not reach it. It did: `.auth-light` re-declared the palette variables, but the app
   * applies its text colour once on <body>, outside that subtree, so after signing out of
   * dark mode the heading, the labels and the value you typed were all near-white on a white
   * card. Comparing the two themes rather than asserting a colour literal, because the point
   * is that they agree, and it does not go stale when the palette is retuned.
   *
   * Has to be an e2e test: this is real stylesheet cascade and inheritance, and jsdom loads
   * no CSS, so the component tests cannot see it.
   */
  test('a stored dark theme does not leak into the login page', async ({ page }) => {
    const readColours = async (theme: string) => {
      await page.goto('/login');
      await page.evaluate((value) => localStorage.setItem('theme', value), theme);
      await page.reload();
      const email = page.getByLabel('Email', { exact: true });
      await expect(email).toBeVisible();
      return email.evaluate((node) => {
        const root = node.closest('.auth-light');
        const heading = root?.querySelector('h1');
        return {
          text: getComputedStyle(node).color,
          heading: heading ? getComputedStyle(heading).color : null,
          // What the browser paints from rather than our variables: Chrome's autofill fill,
          // the caret, an input's own scrollbar.
          scheme: getComputedStyle(node).colorScheme,
        };
      });
    };

    const light = await readColours('light');
    const dark = await readColours('dark');

    expect(dark).toEqual(light);
    expect(dark.scheme).toBe('light');
  });
});
