import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  assignment: { findFirst: vi.fn() },
  assignmentProblem: { count: vi.fn() },
  assignmentProblemGrade: { groupBy: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

const defaultParams = { id: 'course-1', aid: 'assignment-1' };

describe('GET /api/courses/[id]/[aid]/problem-grades/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: defaultParams.aid });
    prismaMock.assignmentProblem.count.mockResolvedValue(2);
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(403);
    expect(prismaMock.assignment.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when assignment is missing', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(404);
  });

  it('returns empty payload when no problems exist', async () => {
    prismaMock.assignmentProblem.count.mockResolvedValue(0);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({});
    expect(prismaMock.assignmentProblemGrade.groupBy).not.toHaveBeenCalled();
  });

  it('returns completion booleans for each student', async () => {
    prismaMock.assignmentProblem.count.mockResolvedValue(3);
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
      { studentId: 's1', _count: { grade: 3 } },
      { studentId: 's2', _count: { grade: 2 } },
    ]);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      s1: true,
      s2: false,
    });
  });
});
