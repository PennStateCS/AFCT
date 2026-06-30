import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  assignment: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  submission: { findMany: vi.fn() },
  comment: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/assignments/[id]/student-context', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/assignments/a1/student-context'), {
      params: Promise.resolve({ id: 'a1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 404 when assignment does not exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/assignments/a1/student-context'), {
      params: Promise.resolve({ id: 'a1' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns grouped student context', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'a1',
      courseId: 'c1',
      isPublished: true,
      problems: [{ problemId: 'p1' }, { problemId: 'p2' }],
    });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1' });
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 's1',
        submittedAt: new Date('2026-03-01T10:00:00.000Z'),
        grade: 95,
        feedback: 'Nice',
        correct: true,
        fileName: 'f.jff',
        originalFileName: 'orig.jff',
        problemId: 'p1',
      },
    ]);
    prismaMock.comment.findMany.mockResolvedValue([
      {
        id: 'c1',
        content: 'LGTM',
        createdAt: new Date('2026-03-01T11:00:00.000Z'),
        problemId: 'p1',
        roster: {
          role: 'FACULTY',
          user: { firstName: 'Ada', lastName: 'Lovelace' },
        },
      },
    ]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([{ problemId: 'p1', grade: 95 }]);

    const res = await GET(new Request('http://localhost/api/assignments/a1/student-context'), {
      params: Promise.resolve({ id: 'a1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assignmentGrade).toBe(95);
    expect(body.submissionCount).toBe(1);
    expect(body.submissionsByProblem.p1).toHaveLength(1);
    expect(body.submissionsByProblem.p2).toHaveLength(0);
    expect(body.commentsByProblem.p1).toHaveLength(1);
    expect(body.commentsByProblem.p2).toHaveLength(0);
  });
});
