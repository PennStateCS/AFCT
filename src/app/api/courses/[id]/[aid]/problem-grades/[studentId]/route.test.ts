import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  assignment: { findFirst: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

const defaultParams = { id: 'course-1', aid: 'assignment-1', studentId: 'student-1' };

describe('GET /api/courses/[id]/[aid]/problem-grades/[studentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: defaultParams.aid });
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when student tries to view someone else', async () => {
    authMock.mockResolvedValue({ user: { id: 'other-student', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(403);
    expect(prismaMock.assignment.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when assignment does not exist', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(404);
  });

  it('returns 204 when no grades are present', async () => {
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(204);
    await expect(res.text()).resolves.toBe('');
  });

  it('returns grade map with timestamps when data exists', async () => {
    const updatedAt = new Date('2026-02-15T12:00:00.000Z');
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      { problemId: 'prob-1', grade: 10, feedback: 'Nice work', updatedAt },
      { problemId: 'prob-2', grade: null, feedback: null, updatedAt },
    ]);

    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      'prob-1': { grade: 10, feedback: 'Nice work', updatedAt: updatedAt.toISOString() },
      'prob-2': { grade: null, feedback: null, updatedAt: updatedAt.toISOString() },
    });
  });
});
