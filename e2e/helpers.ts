import { expect, type Browser, type Page } from '@playwright/test';

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

/** The course ids currently linked from a signed-in user's dashboard. */
export async function courseIdsFor(page: Page, role: Role): Promise<string[]> {
  await signIn(page, role);
  // NOT waitForLoadState('networkidle'): this app polls (session heartbeats), so the
  // network never goes idle and that wait simply burns the timeout. Wait for the thing
  // we actually need instead.
  await page
    .locator('a[href^="/dashboard/courses/"]')
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })
    .catch(() => {
      /* a user with no courses is a legitimate answer; fall through to an empty list */
    });
  const hrefs = await page
    .getByRole('link')
    .evaluateAll((els) =>
      els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? '').filter(Boolean),
    );
  return [
    ...new Set(
      hrefs
        .map((h) => /^\/dashboard\/courses\/([^/]+)$/.exec(h)?.[1])
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

/**
 * Resolve a course that `staff` manages AND `student` is enrolled in.
 *
 * The seed uses cuid()s, so every re-seed changes every id. Hard-coding one made the
 * specs pass until the next `npm run e2e:db` and then fail with a confusing 403, so the
 * fixture is discovered at run time instead. Also returns a course the student is NOT in,
 * for the negative case.
 */
export async function resolveCourses(
  browser: Browser,
  staff: Role = 'faculty2',
  student: Role = 'student',
): Promise<{ shared: string; notEnrolled: string | null }> {
  // A context per role, not one page reused. Navigating to /login while already
  // authenticated redirects straight back to the dashboard, so the second sign-in never
  // finds the email field and simply hangs until the hook times out.
  const inFreshContext = async (role: Role) => {
    const context = await browser.newContext();
    try {
      return await courseIdsFor(await context.newPage(), role);
    } finally {
      await context.close();
    }
  };

  const studentCourses = await inFreshContext(student);
  const staffCourses = await inFreshContext(staff);

  const shared = staffCourses.find((id) => studentCourses.includes(id));
  if (!shared) {
    throw new Error(
      `No seeded course has both ${staff} as staff and ${student} enrolled. ` +
        `staff=[${staffCourses}] student=[${studentCourses}]`,
    );
  }
  return {
    shared,
    notEnrolled: staffCourses.find((id) => !studentCourses.includes(id)) ?? null,
  };
}
