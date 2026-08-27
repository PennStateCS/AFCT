import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// POST /api/courses/[id]/submissions/rerun requeues every submission in a course by
// resetting it to PENDING and logging a rerun for each one.

const prismaMock = vi.hoisted(() => ({
  // updateManyAndReturn: the ids come back from the statement that reset them, so the
  // per-submission audit rows describe exactly what was re-queued.
  submission: { updateManyAndReturn: vi.fn() },
  roster: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
  activityLog: { createMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

const makeRequest = () =>
  new NextRequest('http://localhost/api/courses/c1/submissions/rerun', { method: 'POST' });

const params = (id = 'c1') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  // Default: the course is not archived, so the wrapper's archive freeze is a no-op.
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
});

describe('POST /api/courses/[id]/submissions/rerun', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(401);
    expect(prismaMock.submission.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('returns 403 when the user is not course staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(403);
    expect(prismaMock.submission.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('requeues all submissions in one statement and returns the count', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.submission.updateManyAndReturn.mockResolvedValue([
      { id: 's1', assignmentId: 'a1', problemId: 'p1', studentId: 'stu1' },
      { id: 's2', assignmentId: 'a1', problemId: 'p2', studentId: 'stu2' },
    ]);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true, count: 2 });

    // A single statement. Clearing the claim token is what fences a worker mid-evaluation;
    // resetting attempts only gives a fresh budget, and used to hand the same value back to a
    // stale worker on the next claim.
    expect(prismaMock.submission.updateManyAndReturn).toHaveBeenCalledTimes(1);
    expect(prismaMock.submission.updateManyAndReturn).toHaveBeenCalledWith(
      expect.objectContaining({
        // Submissions already queued or being graded are left where they are: re-queuing one
        // that is running now produces a second run of the same work.
        where: { courseId: 'c1', status: { notIn: ['PENDING', 'PROCESSING'] } },
        data: expect.objectContaining({
          status: 'PENDING',
          feedback: null,
          correct: null,
          attempts: 0,
          processingToken: null,
        }),
      }),
    );

    // Exactly one batch-summary event, and no per-submission N+1 logging.
    const summary = activityLogMock.mock.calls.filter(
      (call) => call[2]?.action === 'COURSE_SUBMISSIONS_RERUN',
    );
    expect(summary).toHaveLength(1);
    expect(summary[0]?.[2]?.metadata?.count).toBe(2);
    expect(activityLogMock.mock.calls.some((c) => c[2]?.action === 'SUBMISSION_RERUN')).toBe(false);
  });

  it('returns 409 and does not requeue when the course is archived', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(409);
    expect(prismaMock.submission.updateManyAndReturn).not.toHaveBeenCalled();
  });

  it('returns 202 with a count of 0 when the course has no submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.submission.updateManyAndReturn.mockResolvedValue([]);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ success: true, count: 0 });
  });

  it('returns 500 when the requeue fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'TA' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });
    prismaMock.submission.updateManyAndReturn.mockRejectedValue(new Error('update failed'));

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(500);
  });

  // A thrown non-Error is recorded as the 'unknown error' message by logError.
  it('returns 500 and logs unknown error when a non-Error is thrown', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'TA' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });
    prismaMock.submission.updateManyAndReturn.mockRejectedValueOnce('boom');

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(500);
    const errorLog = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'COURSE_SUBMISSIONS_RERUN_ERROR',
    );
    expect(errorLog?.[2]?.metadata?.error).toBe('unknown error');
  });
});

/**
 * A course-wide rerun changes every grade it touches, and the worker's later
 * SUBMISSION_AUTOGRADED entries look exactly like ordinary first gradings. The per-submission
 * rows and the shared batch id are what connect a changed mark back to the person who ordered
 * the sweep.
 */
describe('course rerun audit', () => {
  it('writes a row per submission, tied to the summary by one batch id', async () => {
    authMock.mockResolvedValue({ user: { id: 'staff', isAdmin: true } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
    prismaMock.submission.updateManyAndReturn.mockResolvedValue([
      { id: 's1', assignmentId: 'a1', problemId: 'p1', studentId: 'stu1' },
      { id: 's2', assignmentId: 'a2', problemId: 'p2', studentId: 'stu2' },
    ]);

    const res = await POST(
      new NextRequest('http://localhost/api/courses/c1/submissions/rerun', { method: 'POST' }),
      { params: Promise.resolve({ id: 'c1' }) },
    );
    expect(res.status).toBe(202);

    const rows = prismaMock.activityLog.createMany.mock.calls[0]?.[0]?.data ?? [];
    expect(rows).toHaveLength(2);
    // The indexed column, not just metadata: a query for one submission's history is the
    // reason these rows exist.
    expect(rows.map((r: { submissionId: string }) => r.submissionId)).toEqual(['s1', 's2']);
    expect(rows[0].action).toBe('SUBMISSION_RERUN');

    const summary = activityLogMock.mock.calls.at(-1)?.[2];
    expect(summary.action).toBe('COURSE_SUBMISSIONS_RERUN');
    expect(summary.metadata.count).toBe(2);
    // Both ends carry the same id, so the sweep reconstructs from either direction.
    expect(summary.metadata.batchId).toBe(rows[0].metadata.batchId);
  });

  it('writes no per-submission rows when nothing was re-queued', async () => {
    authMock.mockResolvedValue({ user: { id: 'staff', isAdmin: true } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
    prismaMock.submission.updateManyAndReturn.mockResolvedValue([]);

    await POST(
      new NextRequest('http://localhost/api/courses/c1/submissions/rerun', { method: 'POST' }),
      { params: Promise.resolve({ id: 'c1' }) },
    );

    expect(prismaMock.activityLog.createMany).not.toHaveBeenCalled();
  });
});
