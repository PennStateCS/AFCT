import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
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

describe('GET /api/assignments/[id]/problems', () => {
  it('returns 400 when assignmentId missing', async () => {
    const req = new NextRequest('http://localhost/api/assignments//problems');
    const res = await GET(req, { params: Promise.resolve({ id: '' }) });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1/problems');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 (and logs a denial) when role is not ADMIN or FACULTY', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isGroup: false });

    const req = new NextRequest('http://localhost/api/assignments/a1/problems');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'ASSIGNMENT_PROBLEMS_LIST_DENIED',
        severity: 'SECURITY',
      }),
    );
  });

  it('returns 404 when assignment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/assignments/a1/problems');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('returns problems list', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isGroup: false });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P',
          description: null,
          type: 'FA',
          maxStates: null,
          isDeterministic: null,
        },
        submissions: [{ id: 's1' }],
        AssignmentProblemGrade: { grade: 85 },
      },
    ]);

    const req = new NextRequest('http://localhost/api/assignments/a1/problems', {
      headers: { authorization: 'Bearer test-token' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toMatchObject({ id: 'p1', solved: true, grade: 85 });
  });

  it('still returns problems when activity logging fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isGroup: false });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P',
          description: null,
          type: 'FA',
          maxStates: null,
          isDeterministic: null,
        },
        submissions: [],
      },
    ]);
    activityLogMock.mockRejectedValueOnce(new Error('log down'));

    const req = new NextRequest('http://localhost/api/assignments/a1/problems');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].id).toBe('p1');
    consoleSpy.mockRestore();
  });

  it('returns 500 when fetching problems throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isGroup: false });
    prismaMock.assignmentProblem.findMany.mockRejectedValueOnce(new Error('db down'));

    const req = new NextRequest('http://localhost/api/assignments/a1/problems');
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

});
