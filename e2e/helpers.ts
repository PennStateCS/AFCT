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

/** A user's own id, read from the session. */
async function userIdOf(browser: Browser, role: Role): Promise<string> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, role);
    const res = await page.request.get('/api/me');
    if (!res.ok()) throw new Error(`/api/me failed for ${role}: ${res.status()}`);
    return ((await res.json()) as { id: string }).id;
  } finally {
    await context.close();
  }
}

/**
 * Build a course owned by `staff` with `student` enrolled, and return its id.
 *
 * These specs used to hunt for a seeded course that happened to have both people on it.
 * That was wrong twice over: the seed's cuids change on every re-seed, and its roster
 * assignment is randomised, so whether any such course exists is luck. A run that found
 * one passed; the next found faculty2 teaching one course and the student in three
 * others, and failed for a reason that had nothing to do with the code under test.
 *
 * Owning the fixture makes the specs deterministic and independent of seed changes. The
 * test database is reset before each run, so nothing accumulates.
 */
export async function createFixtureCourse(browser: Browser): Promise<string> {
  const [staffId, studentId] = await Promise.all([
    userIdOf(browser, 'faculty2'),
    userIdOf(browser, 'student'),
  ]);

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, 'admin');

    const now = Date.now();
    const iso = (daysFromNow: number) => new Date(now + daysFromNow * 86_400_000).toISOString();

    const courseName = unique('E2E Fixture Course');
    // Letters then digits: the code format is validated.
    const courseCode = `TSTE ${Math.floor(Math.random() * 900 + 100)}`;

    const created = await page.request.post('/api/courses', {
      data: {
        name: courseName,
        code: courseCode,
        semester: 'Summer 2026',
        credits: 3,
        startDate: iso(-7),
        endDate: iso(120),
        registrationOpenAt: iso(-14),
        registrationCloseAt: iso(60),
        timezone: 'America/New_York',
        instructorIds: [staffId],
      },
    });
    if (!created.ok()) {
      throw new Error(`fixture course create failed: ${created.status()} ${await created.text()}`);
    }
    // The create route wraps its payload: { success, message, course: {...} }.
    const courseId = ((await created.json()) as { course: { id: string } }).course.id;

    // Enrol a second student as well: the "assigned to someone else" case needs a real
    // classmate to point the audience at, and an empty audience is rejected by
    // validation, so "assigned to nobody" is not a reachable state to test with.
    // The list endpoint is server-paginated; a large pageSize fetches everyone in one page.
    const users = (await (
      await page.request.get('/api/admin/users/list?pageSize=100')
    ).json()) as unknown;
    const userList = (
      Array.isArray(users)
        ? users
        : ((users as { rows?: unknown[]; users?: unknown[] }).rows ??
          (users as { users?: unknown[] }).users ??
          [])
    ) as Array<{ id: string; email: string }>;
    const classmate = userList.find(
      (u) => u.email?.startsWith('student') && u.id !== studentId,
    );

    // A course cannot be created published (the create schema enforces it), and an
    // unpublished course is invisible to students - which showed up as a puzzling 403
    // on every student assertion until the fixture started publishing it.
    const published = await page.request.put(`/api/courses/${courseId}`, {
      data: {
        name: courseName,
        code: courseCode,
        semester: 'Summer 2026',
        credits: 3,
        startDate: iso(-7),
        endDate: iso(120),
        registrationOpenAt: iso(-14),
        registrationCloseAt: iso(60),
        timezone: 'America/New_York',
        isPublished: true,
        isArchived: false,
      },
    });
    if (!published.ok()) {
      throw new Error(`fixture publish failed: ${published.status()} ${await published.text()}`);
    }

    const enrolled = await page.request.post(`/api/courses/${courseId}/roster/bulk`, {
      data: { userIds: [studentId, ...(classmate ? [classmate.id] : [])] },
    });
    if (!enrolled.ok()) {
      throw new Error(`fixture enrol failed: ${enrolled.status()} ${await enrolled.text()}`);
    }

    return courseId;
  } finally {
    await context.close();
  }
}

/** A course the student cannot read at all, for negative cases. */
export async function courseWithoutStudent(browser: Browser): Promise<string | null> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await signIn(page, 'admin');
    const res = await page.request.get('/api/courses');
    if (!res.ok()) return null;
    const body = (await res.json()) as unknown;
    const all = (Array.isArray(body) ? body : ((body as { courses?: unknown[] }).courses ?? [])) as
      Array<{ id: string }>;

    const studentContext = await browser.newContext();
    try {
      const studentPage = await studentContext.newPage();
      await signIn(studentPage, 'student');
      for (const course of all) {
        const seen = await studentPage.request.get(`/api/courses/${course.id}`);
        if (!seen.ok()) return course.id;
      }
    } finally {
      await studentContext.close();
    }
    return null;
  } finally {
    await context.close();
  }
}
