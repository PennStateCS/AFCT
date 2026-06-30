import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// POST /api/course_submissions/[cid] requeues every submission in a course by
// resetting it to PENDING and logging a rerun for each one.

const prismaMock = vi.hoisted(() => ({
  submission: { findMany: vi.fn(), update: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

const makeRequest = () =>
  new NextRequest('http://localhost/api/course_submissions/c1', { method: 'POST' });

const params = (cid = 'c1') => ({ params: Promise.resolve({ cid }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/course_submissions/[cid]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(401);
    expect(prismaMock.submission.update).not.toHaveBeenCalled();
  });

  it('returns 403 when the user role is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(403);
    expect(prismaMock.submission.update).not.toHaveBeenCalled();
  });

  it('requeues every submission in the course and returns the count', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.submission.findMany.mockResolvedValue([
      { id: 's1', courseId: 'c1', assignmentId: 'a1', problemId: 'p1' },
      { id: 's2', courseId: 'c1', assignmentId: 'a1', problemId: 'p2' },
    ]);
    prismaMock.submission.update.mockResolvedValue({});

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ success: true, count: 2 });

    expect(prismaMock.submission.update).toHaveBeenCalledTimes(2);
    expect(prismaMock.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({ status: 'PENDING', feedback: null, correct: null }),
      }),
    );

    const rerunLogs = activityLogMock.mock.calls.filter(
      (call) => call[2]?.action === 'SUBMISSION_RERUN',
    );
    expect(rerunLogs).toHaveLength(2);
  });

  it('returns 202 with a count of 0 when the course has no submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.submission.findMany.mockResolvedValue([]);

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({ success: true, count: 0 });
    expect(prismaMock.submission.update).not.toHaveBeenCalled();
  });

  it('returns 500 when a submission update fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'TA' } });
    prismaMock.submission.findMany.mockResolvedValue([
      { id: 's1', courseId: 'c1', assignmentId: 'a1', problemId: 'p1' },
    ]);
    prismaMock.submission.update.mockRejectedValue(new Error('update failed'));

    const res = await POST(makeRequest(), params());

    expect(res.status).toBe(500);
  });
});
