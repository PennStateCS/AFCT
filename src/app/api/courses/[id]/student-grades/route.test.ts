import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findUnique: vi.fn() },
  assignment: { findMany: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
  submission: { groupBy: vi.fn(), findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

const makeRequest = () =>
  new Request('http://localhost/api/courses/c1/student-grades');
const params = (id = 'c1') => ({ params: Promise.resolve({ id }) });

const seedGradeData = () => {
  prismaMock.assignment.findMany.mockResolvedValue([
    {
      id: 'a1',
      title: 'Assignment 1',
      description: 'Desc',
      dueDate: new Date('2025-01-01T00:00:00.000Z'),
    },
  ]);
  prismaMock.assignmentProblem.findMany.mockResolvedValue([
    {
      assignmentId: 'a1',
      maxPoints: 10,
      maxSubmissions: 3,
      problem: { id: 'p1', title: 'Problem 1', autograderEnabled: true },
    },
  ]);
  prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
    { assignmentId: 'a1', problemId: 'p1', grade: 7 },
  ]);
  prismaMock.submission.groupBy.mockResolvedValue([
    { assignmentId: 'a1', problemId: 'p1', _count: { id: 2 } },
  ]);
  prismaMock.submission.findMany.mockResolvedValue([
    { assignmentId: 'a1', problemId: 'p1', status: 'GRADED' },
  ]);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/[id]/student-grades', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(401);
  });

  it('returns 403 when the user is neither enrolled nor staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findUnique.mockResolvedValue(null);

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(403);
  });

  it('returns assignment grade payload for an enrolled student', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findUnique.mockResolvedValue({ id: 'r1' });
    seedGradeData();

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0]).toMatchObject({
      id: 'a1',
      title: 'Assignment 1',
      maxPoints: 10,
      grade: 7,
    });
    expect(body.assignments[0].problems[0]).toMatchObject({
      id: 'p1',
      status: 'GRADED',
      submissionCount: 2,
      grade: 7,
      maxPoints: 10,
      maxSubmissions: 3,
    });
  });

  it('allows staff to view grades without course membership', async () => {
    authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
    prismaMock.roster.findUnique.mockResolvedValue(null);
    seedGradeData();

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(200);
  });

  it('returns 500 when the query fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.assignment.findMany.mockRejectedValue(new Error('db down'));

    const res = await GET(makeRequest(), params());

    expect(res.status).toBe(500);
  });
});
