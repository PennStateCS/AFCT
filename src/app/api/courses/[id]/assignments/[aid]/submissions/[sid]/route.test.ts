import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
  roster: { findFirst: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
  submission: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('GET /api/courses/[id]/[aid]/submissions/[sid]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(401);
  });

  it('returns 404 when assignment not found', async () => {
    // Admin passes the wrapper's access gate, then hits the handler's 404.
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(404);
  });

  it('returns 404 when no problems', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(404);
  });

  it('returns grouped submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P1',
          description: null,
          type: null,
          maxStates: null,
          isDeterministic: null,
          originalFileName: null,
        },
      },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 's1',
        submittedAt: new Date('2025-01-01'),
        feedback: 'ok',
        correct: true,
        fileName: 'f1',
        originalFileName: 'o1',
        problemId: 'p1',
      },
    ]);

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.p1.submissions).toHaveLength(1);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 403 for staff not on the course roster', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });

  it('allows staff on the roster to view any student submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'FACULTY' });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P1',
          description: null,
          type: null,
          maxStates: null,
          isDeterministic: null,
          originalFileName: null,
        },
      },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([]);

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(200);
  });

  it('returns 403 when a student requests another student’s submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-a', role: 'STUDENT' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/student-b'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 'student-b' }),
      },
    );

    expect(res.status).toBe(403);
  });

  it('returns 403 when an enrolled student requests another student’s submissions', async () => {
    // Enrolled as a student (read access granted by the wrapper) but requesting a
    // different student and not a manager -> hits the in-handler denial.
    authMock.mockResolvedValue({ user: { id: 'student-a', role: 'STUDENT' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT' });

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/student-b'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 'student-b' }),
      },
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
    // Reached the handler (assignment lookup) before denying.
    expect(prismaMock.assignment.findFirst).toHaveBeenCalled();
  });

  it('allows a student to view their own submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-a', role: 'STUDENT' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT' });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P1',
          description: null,
          type: null,
          maxStates: null,
          isDeterministic: null,
          originalFileName: null,
        },
      },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([]);

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/student-a'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 'student-a' }),
      },
    );

    expect(res.status).toBe(200);
  });

  it('404-masks an unpublished assignment for the owning student', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-a', role: 'STUDENT' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: false });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT' });

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/student-a'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 'student-a' }),
      },
    );

    expect(res.status).toBe(404);
    // Never reaches the problem/submission queries.
    expect(prismaMock.assignmentProblem.findMany).not.toHaveBeenCalled();
  });

  it('handles P2022 Prisma error for evaluationRaw and retries', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P1',
          description: null,
          type: null,
          maxStates: null,
          isDeterministic: null,
          originalFileName: null,
        },
      },
    ]);

    const { Prisma } = await import('@prisma/client');
    const error = new Prisma.PrismaClientKnownRequestError('Column error', {
      code: 'P2022',
      clientVersion: '5.0.0',
      meta: { column: 'evaluationRaw' },
    });

    prismaMock.submission.findMany.mockRejectedValueOnce(error).mockResolvedValueOnce([
      {
        id: 's1',
        submittedAt: new Date('2025-01-01'),
        feedback: 'ok',
        correct: true,
        fileName: 'f1',
        originalFileName: 'o1',
        problemId: 'p1',
      },
    ]);

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(200);
    expect(prismaMock.submission.findMany).toHaveBeenCalledTimes(2);
  });

  it('rethrows non-P2022 Prisma errors', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P1',
          description: null,
          type: null,
          maxStates: null,
          isDeterministic: null,
          originalFileName: null,
        },
      },
    ]);

    const { Prisma } = await import('@prisma/client');
    const error = new Prisma.PrismaClientKnownRequestError('Other error', {
      code: 'P2025',
      clientVersion: '5.0.0',
    });

    prismaMock.submission.findMany.mockRejectedValue(error);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch submissions');

    consoleSpy.mockRestore();
  });

  it('rethrows a P2022 error with no column metadata', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P1',
          description: null,
          type: null,
          maxStates: null,
          isDeterministic: null,
          originalFileName: null,
        },
      },
    ]);

    const { Prisma } = await import('@prisma/client');
    // P2022 but with no `meta.column` -> `?? ''` fallback, does not include
    // 'evaluationRaw', so the error is rethrown rather than retried.
    const error = new Prisma.PrismaClientKnownRequestError('Column error', {
      code: 'P2022',
      clientVersion: '5.0.0',
    });
    prismaMock.submission.findMany.mockRejectedValue(error);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(500);
    expect(prismaMock.submission.findMany).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('does not fail request when activity logging fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1', isPublished: true });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P1',
          description: null,
          type: null,
          maxStates: null,
          isDeterministic: null,
          originalFileName: null,
        },
      },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([]);
    activityLogMock.mockRejectedValue(new Error('Log failed'));

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledWith('Failed to log activity:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('returns 500 when unexpected error occurs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.assignment.findFirst.mockRejectedValue(new Error('DB error'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await GET(
      new Request('http://localhost/api/courses/c1/assignments/a1/submissions/s1'),
      {
        params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
      },
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch submissions');

    consoleSpy.mockRestore();
  });
});
