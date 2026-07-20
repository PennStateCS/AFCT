import { expect, type Page } from '@playwright/test';

/**
 * Seeded accounts. The dev seed gives every user the same password, which is fine
 * because this database is local, throwaway, and recreated before each run.
 */
export const USERS = {
  admin: { email: 'admin@example.com', password: 'password123' },
  // faculty@example.com is ALSO flagged isAdmin by the seed, so it is a poor proxy
  // for 'what can a plain instructor do'. faculty2 (Bruce Wayne) is faculty-only.
  faculty: { email: 'faculty@example.com', password: 'password123' },
  faculty2: { email: 'faculty2@example.com', password: 'password123' },
  student: { email: 'student@example.com', password: 'password123' },
} as const;

export type Role = keyof typeof USERS;

/**
 * Sign in through the real login form.
 *
 * Deliberately going through the UI rather than injecting a session cookie: the login
 * form plus the NextAuth credentials flow plus the redirect is itself one of the
 * workflows worth protecting, and it breaks in ways a forged cookie would hide.
 */
export async function signIn(page: Page, role: Role) {
  const { email, password } = USERS[role];

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  // The redirect target differs by role, so assert on leaving /login rather than on a
  // specific destination. Individual specs assert what they actually expect to see.
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/**
 * A course title unique to this run, so a failed run that leaves rows behind cannot
 * make the next run pass or fail for the wrong reason.
 *
 * Playwright forbids Date.now() nowhere, but tests that embed a raw timestamp are hard
 * to read in failure output; the short suffix keeps it greppable.
 */
export function unique(prefix: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix} ${suffix}`;
}
