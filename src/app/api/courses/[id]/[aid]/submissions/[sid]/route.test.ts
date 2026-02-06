import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
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
});

describe('GET /api/courses/[id]/[aid]/submissions/[sid]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/c1/a1/submissions/s1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when assignment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/c1/a1/submissions/s1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 404 when no problems', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);

    const res = await GET(new Request('http://localhost/api/courses/c1/a1/submissions/s1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns grouped submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: 'a1' });
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

    const res = await GET(new Request('http://localhost/api/courses/c1/a1/submissions/s1'), {
      params: Promise.resolve({ id: 'c1', aid: 'a1', sid: 's1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.p1.submissions).toHaveLength(1);
    expect(activityLogMock).toHaveBeenCalled();
  });
});
