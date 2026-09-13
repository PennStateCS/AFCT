import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignmentProblem: {
    findUnique: vi.fn(),
    // The GET scopes its lookup to the course in the path, so it reads through findFirst.
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  // Lowering the points is refused below a grade already given, decided under the link's row
  // lock so a grader cannot commit against the old maximum afterwards.
  assignmentProblemGrade: { findFirst: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
  course: {
    findUnique: vi.fn(),
  },
  roster: {
    findFirst: vi.fn(),
  },
  // The settings dialog reads how many attempts already exist, so GET needs this delegate.
  submission: {
    count: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, PUT } from './route';

describe('PUT /api/courses/[id]/[aid]/problems/[pid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks doesn't reset implementations, so drop any leaked mockRejectedValue.
    activityLogMock.mockReset();
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.roster.findFirst.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      assignment: { courseId: 'c1' },
      problem: { title: 'Problem 1' },
      // The current points, which is what a lowering is measured against.
      maxPoints: 10,
    });
    prismaMock.$queryRaw.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(prismaMock),
    );
    // Nothing graded unless a test says otherwise.
    prismaMock.assignmentProblemGrade.findFirst.mockResolvedValue(null);
    prismaMock.assignmentProblem.update.mockResolvedValue({
      assignmentId: 'a1',
      problemId: 'p1',
      maxPoints: 20,
      maxSubmissions: 3,
      autograderEnabled: true,
    });
  });

  it('returns 403 when user is unauthorized', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1' } });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 409 when the course is archived', async () => {
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(409);
    expect(prismaMock.assignmentProblem.update).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid payload', async () => {
    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when assignment problem link is missing', async () => {
    prismaMock.assignmentProblem.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(404);
  });

  /**
   * Grades are checked against the points when they are entered, and nothing checked the other
   * direction: dropping a 10-point problem to 5 left a student sitting at 10/5, which also
   * reaches the LMS as a score above its own maximum.
   */
  describe('lowering the points', () => {
    const setPointsTo = (maxPoints: number) =>
      PUT(
        new Request('http://localhost/x', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxPoints, maxSubmissions: -1, autograderEnabled: false }),
        }),
        { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) },
      );

    it('is refused below a grade already given', async () => {
      prismaMock.assignmentProblemGrade.findFirst.mockResolvedValue({ grade: 9 });

      const res = await setPointsTo(5);

      expect(res.status).toBe(409);
      expect(prismaMock.assignmentProblem.update).not.toHaveBeenCalled();
      await expect(res.json()).resolves.toMatchObject({ error: expect.stringContaining('9') });
    });

    it('is allowed when it still covers every grade given', async () => {
      prismaMock.assignmentProblemGrade.findFirst.mockResolvedValue({ grade: 4 });

      expect((await setPointsTo(5)).status).toBe(200);
      expect(prismaMock.assignmentProblem.update).toHaveBeenCalled();
    });

    it('holds the link row while it decides', async () => {
      // The same row a grade write attaches to, so a grader validating against the old maximum
      // cannot commit after the change.
      await setPointsTo(5);

      expect(String(prismaMock.$queryRaw.mock.calls[0]?.[0])).toContain('FOR UPDATE');
    });

    it('does not look at grades when the points are going up', async () => {
      await setPointsTo(25);

      expect(prismaMock.assignmentProblemGrade.findFirst).not.toHaveBeenCalled();
    });
  });

  it('updates assignment problem settings', async () => {
    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 25, maxSubmissions: -1, autograderEnabled: false }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(200);

    expect(prismaMock.assignmentProblem.update).toHaveBeenCalledWith({
      where: {
        assignmentId_problemId: {
          assignmentId: 'a1',
          problemId: 'p1',
        },
      },
      data: {
        maxPoints: 25,
        maxSubmissions: -1,
        autograderEnabled: false,
        // Not in the request body above. The schema defaults it to true rather than false, so
        // an older client that knows nothing about this setting cannot switch feedback off.
        showFeedback: true,
      },
      select: {
        assignmentId: true,
        problemId: true,
        maxPoints: true,
        maxSubmissions: true,
        autograderEnabled: true,
        showFeedback: true,
      },
    });
  });

  it('returns 400 for an invalid JSON body', async () => {
    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body.');
  });

  it('still succeeds when activity logging fails', async () => {
    activityLogMock.mockRejectedValue(new Error('log down'));

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 when the link belongs to a different course', async () => {
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      assignment: { courseId: 'other-course' },
      problem: { title: 'Problem 1' },
    });

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the update fails', async () => {
    prismaMock.assignmentProblem.update.mockRejectedValue(new Error('db down'));

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(500);
  });

  it('returns 500 and logs when a non-Error is thrown', async () => {
    prismaMock.assignmentProblem.update.mockRejectedValue('boom');

    const req = new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'ASSIGNMENT_PROBLEM_SETTINGS_UPDATE_ERROR',
        metadata: { error: 'unknown error' },
      }),
    );
  });
});

/**
 * What the attempt count on the settings dialog counts.
 *
 * The dialog shows how many attempts have been made at this problem on this assignment, and
 * that number is what tells an instructor whether lowering the cap would strand somebody. The
 * prisma mock answers with its fixture whatever the `where` says, so without either key the
 * count is every attempt at the problem across every assignment, or every attempt on the
 * assignment across every problem.
 */
/**
 * Whose settings the GET will hand over.
 *
 * The wrapper authorises the caller against the course in the path and then passes the
 * assignment and problem ids straight from the URL. Reading the pair without the course meant
 * somebody who runs one course could pull another course's points, attempt cap, autograder
 * settings and submission count out of it, knowing only its ids. The PUT next door always
 * checked; the GET did not.
 */
describe('what the settings read is scoped to', () => {
  const get = () =>
    GET(new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.roster.findFirst.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
    prismaMock.submission.count.mockResolvedValue(0);
  });

  it('asks for the pair inside this course, not the pair on its own', async () => {
    prismaMock.assignmentProblem.findFirst.mockResolvedValue({
      maxPoints: 10,
      maxSubmissions: 1,
      autograderEnabled: true,
      showFeedback: true,
    });

    await get();

    expect(prismaMock.assignmentProblem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assignmentId: 'a1', problemId: 'p1', assignment: { courseId: 'c1' } },
      }),
    );
  });

  it('404s for a pair that belongs to a different course', async () => {
    // The scoped query simply finds nothing, which is the same answer as a pair that does not
    // exist: an instructor in this course learns nothing either way.
    prismaMock.assignmentProblem.findFirst.mockResolvedValue(null);

    expect((await get()).status).toBe(404);
  });
});

describe('what the attempt count is scoped to', () => {
  it('counts attempts at this problem on this assignment', async () => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.roster.findFirst.mockResolvedValue(null);
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
    prismaMock.assignmentProblem.findFirst.mockResolvedValue({
      maxPoints: 20,
      maxSubmissions: 3,
      autograderEnabled: true,
      showFeedback: true,
    });
    prismaMock.submission.count.mockResolvedValue(4);

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/problems/p1'),
      { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ submissionCount: 4 });

    expect(prismaMock.submission.count).toHaveBeenCalledWith({
      where: { assignmentId: 'a1', problemId: 'p1' },
    });
  });
});
