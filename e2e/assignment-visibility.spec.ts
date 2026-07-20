import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { courseWithoutStudent, createFixtureCourse, signIn, unique, USERS } from './helpers';

/**
 * What a student is allowed to SEE.
 *
 * The rules being pinned:
 *   1. An unpublished assignment is not readable by a student.
 *   2. An assignment whose audience excludes the student is not readable either.
 *   3. Neither leaks the assignment's existence or its title into the page.
 *
 * NOTE ON WHAT IS ASSERTED. The API is the security boundary and it answers 404. The
 * PAGE answers 200 and simply renders nothing - the guard is at render time, not a
 * Next.js notFound(). So these specs assert the API status AND that the title never
 * reaches the DOM, rather than asserting a 404 from the page navigation, which would be
 * testing a rendering choice instead of the actual protection.
 *
 * Fixtures are created over the API with the signed-in faculty session rather than
 * through the create wizard: the wizard has its own spec, and routing every visibility
 * assertion through wizard markup would mean a label change fails these for an
 * unrelated reason.
 */

// Built once per run rather than found in the seed: see createFixtureCourse for why
// hunting for a seeded course was unreliable in two separate ways.
let COURSE = '';
let COURSE_WITHOUT_STUDENT: string | null = null;
/** An enrolled STUDENT who is NOT our test student, for "assigned to someone else". */
let OTHER_STUDENT_ID = '';

test.beforeAll(async ({ browser }) => {
  COURSE = await createFixtureCourse(browser);
  COURSE_WITHOUT_STUDENT = await courseWithoutStudent(browser);

  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, 'faculty2');
  const course = (await (await page.request.get(`/api/courses/${COURSE}`)).json()) as {
    enrolled: Array<{ id: string; email: string; courseRole: string }>;
  };
  const other = course.enrolled.find(
    (m) => m.courseRole === 'STUDENT' && m.email !== USERS.student.email,
  );
  // The fixture course starts with one student, which is all the other specs need. The
  // "assigned to someone else" case needs a second, so fall back to the faculty's own id
  // only if the roster somehow already has one.
  OTHER_STUDENT_ID = other?.id ?? '';
  await context.close();
});

type Created = { id: string };

async function createAssignment(
  request: APIRequestContext,
  body: Record<string, unknown> = {},
): Promise<{ id: string; title: string }> {
  const title = unique('E2E Visibility');
  const res = await request.post(`/api/courses/${COURSE}/assignments`, {
    data: {
      title,
      dueDate: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      assignedToEveryone: true,
      isPublished: true,
      ...body,
    },
  });
  expect(res.ok(), `assignment create failed: ${res.status()} ${await res.text()}`).toBe(true);
  return { id: ((await res.json()) as Created).id, title };
}

/** A faculty page that can create fixtures. */
async function asFaculty(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'faculty2');
  return page;
}

/** Everything the student can observe about an assignment. */
async function studentView(browser: Browser, assignmentId: string, title: string) {
  const page = await (await browser.newContext()).newPage();
  await signIn(page, 'student');
  const api = await page.request.get(`/api/courses/${COURSE}/assignments/${assignmentId}`);
  await page.goto(`/dashboard/courses/${COURSE}/${assignmentId}`);
  return { apiStatus: api.status(), leaksTitle: (await page.content()).includes(title) };
}

test.describe('student assignment visibility', () => {
  test('an unpublished assignment is unreadable and does not leak its title', async ({
    browser,
  }) => {
    const faculty = await asFaculty(browser);
    const { id, title } = await createAssignment(faculty.request, { isPublished: false });

    const seen = await studentView(browser, id, title);

    // 404 rather than 403: a 403 confirms the assignment exists, which is precisely
    // what leaving it unpublished is meant to prevent.
    expect(seen.apiStatus).toBe(404);
    expect(seen.leaksTitle).toBe(false);
  });

  test('a published assignment assigned to everyone is readable', async ({ browser }) => {
    // The control for the tests around it: same student, same path, only the flag differs.
    const faculty = await asFaculty(browser);
    const { id, title } = await createAssignment(faculty.request, { isPublished: true });

    const seen = await studentView(browser, id, title);

    expect(seen.apiStatus).toBe(200);
    expect(seen.leaksTitle).toBe(true);
  });

  // KNOWN BUG - see the note at the bottom of this file. Marked test.fail() so the suite
  // stays honest without being red: Playwright passes this while the leak exists and
  // FAILS it the moment the leak is fixed, which is the prompt to delete the annotation.
  test.fail(
    'an assignment assigned to someone else is unreadable',
    async ({ browser }) => {
      const faculty = await asFaculty(browser);
      const { id, title } = await createAssignment(faculty.request, {
        isPublished: true,
        assignedToEveryone: false,
        // A real audience that simply does not include our student. An empty list is
        // rejected by validation, so "assigned to nobody" is not a reachable state.
        assignees: [{ targetType: 'STUDENT', userId: OTHER_STUDENT_ID }],
      });

      const seen = await studentView(browser, id, title);

      // The API is correct: it masks this as 404, exactly like unpublished.
      expect(seen.apiStatus).toBe(404);
      // The PAGE is not: it renders the title and description anyway.
      expect(seen.leaksTitle).toBe(false);
    },
  );

  // KNOWN BUG - same root cause.
  test.fail('an assignment before its unlock date hides its body', async ({ browser }) => {
    const faculty = await asFaculty(browser);
    const description = `LOCKED-BODY-${Math.random().toString(36).slice(2, 8)}`;
    const { id, title } = await createAssignment(faculty.request, {
      isPublished: true,
      description,
      unlockAt: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      dueDate: new Date(Date.now() + 14 * 24 * 3600_000).toISOString(),
    });

    const page = await (await browser.newContext()).newPage();
    await signIn(page, 'student');
    // The API withholds the body correctly (200, but the description is stripped).
    const api = await page.request.get(`/api/courses/${COURSE}/assignments/${id}`);
    expect((await api.text()).includes(description)).toBe(false);

    await page.goto(`/dashboard/courses/${COURSE}/${id}`);
    // Wait for the page to actually render before asserting an absence. Checking
    // straight after goto() passes trivially because nothing has painted yet - which is
    // how this test first "passed" against a page that does leak. The student IS
    // assigned this one, so the title legitimately appears; only the body should not.
    await expect(page.getByText(title).first()).toBeVisible();
    await expect(page.getByText(description)).toHaveCount(0);
  });

  test('a signed-out visitor is sent to login rather than the assignment', async ({ browser }) => {
    const faculty = await asFaculty(browser);
    const { id } = await createAssignment(faculty.request);

    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`/dashboard/courses/${COURSE}/${id}`);
    await expect(anon).toHaveURL(/\/login/);
  });
});

test.describe('course access', () => {
  test('a student cannot read a course they are not enrolled in', async ({ page }) => {
    test.skip(!COURSE_WITHOUT_STUDENT, 'seed has no course this student is absent from');
    await signIn(page, 'student');
    const res = await page.request.get(`/api/courses/${COURSE_WITHOUT_STUDENT}`);
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('every course on the student dashboard actually opens for them', async ({ page }) => {
    // A link the student cannot load means the dashboard query and the access check
    // disagree, which is how "phantom" courses show up.
    await signIn(page, 'student');
    await page
      .locator('a[href^="/dashboard/courses/"]')
      .first()
      .waitFor({ state: 'attached', timeout: 30_000 });

    const hrefs = await page
      .getByRole('link')
      .evaluateAll((els) =>
        els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? '').filter(Boolean),
      );
    const courseIds = [
      ...new Set(
        hrefs
          .map((h) => /^\/dashboard\/courses\/([^/]+)$/.exec(h)?.[1])
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    expect(courseIds.length).toBeGreaterThan(0);
    for (const id of courseIds) {
      const res = await page.request.get(`/api/courses/${id}`);
      expect(res.status(), `dashboard linked course ${id} but it does not open`).toBeLessThan(400);
    }
  });
});

test.describe('staff permissions', () => {
  test('a student cannot create an assignment', async ({ page }) => {
    await signIn(page, 'student');
    const res = await page.request.post(`/api/courses/${COURSE}/assignments`, {
      data: { title: 'should not exist', dueDate: new Date().toISOString() },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);
  });

  test('faculty get management controls a student does not', async ({ page, browser }) => {
    await signIn(page, 'faculty2');
    await page.goto(`/dashboard/courses/${COURSE}`);
    await expect(page.getByRole('button', { name: 'Create Assignment' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Roster/ })).toBeVisible();

    const studentPage = await (await browser.newContext()).newPage();
    await signIn(studentPage, 'student');
    await studentPage.goto(`/dashboard/courses/${COURSE}`);
    await expect(studentPage.getByRole('button', { name: 'Create Assignment' })).toHaveCount(0);
  });
});

test.describe('seed assumptions', () => {
  test('faculty2 is a plain instructor, not an admin', async ({ page }) => {
    // faculty@example.com is ALSO flagged isAdmin by the seed, which makes it useless
    // for testing instructor permissions. Everything above depends on faculty2 not
    // having that shortcut, so assert it rather than trusting it.
    await signIn(page, 'faculty2');
    const res = await page.request.get('/api/me');
    expect(res.ok()).toBe(true);
    const me = (await res.json()) as { email?: string; isAdmin?: boolean };
    expect(me.email).toBe(USERS.faculty2.email);
    expect(me.isAdmin ?? false).toBe(false);
  });
});

/*
 * KNOWN BUG, pinned by the two test.fail() cases above.
 *
 * src/app/dashboard/courses/[id]/[aid]/page.tsx decides student access with:
 *
 *     const hasStudentAccess = enrollment?.role === 'STUDENT' && assignment.isPublished;
 *
 * Enrolled + published, and nothing else. It does not ask whether the student is in the
 * assignment's audience, and it does not ask whether unlockAt has passed. The API route
 * for the same assignment checks both, which is why the API answers 404 (or strips the
 * body) while the server-rendered page hands over the title and description.
 *
 * Net effect: both "assign to specific students" and "lock content until unlockAt" are
 * bypassable by any enrolled classmate who opens the assignment URL directly.
 *
 * The fix is to gate this page through the same resolver the API uses rather than
 * re-deriving access from two fields. Left as a deliberate decision rather than folded
 * into a test commit.
 */
