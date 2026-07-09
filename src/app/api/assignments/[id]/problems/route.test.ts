import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
  groupRoster: { findFirst: vi.fn() },
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

  it("group assignment returns only problems for user's group + unassigned problems", async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isGroup: true });
    prismaMock.groupRoster.findFirst.mockResolvedValue({ groupId: 'g1' });

    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      // unassigned problem -> should be visible
      {
        problem: {
          id: 'p-unassigned',
          title: 'Unassigned',
          description: null,
          type: 'FA',
          maxStates: null,
          isDeterministic: null,
          groupAssignmentProblems: [],
        },
        submissions: [],
      },
      // mapped to user's group -> visible and marked solved (submission was returned by query)
      {
        problem: {
          id: 'p-g1',
          title: 'Group 1 Problem',
          description: null,
          type: 'FA',
          maxStates: null,
          isDeterministic: null,
          groupAssignmentProblems: [{ groupId: 'g1' }],
        },
        submissions: [{ id: 's-g1' }],
      },
      // mapped to another group -> should NOT be visible
      {
        problem: {
          id: 'p-g2',
          title: 'Group 2 Problem',
          description: null,
          type: 'FA',
          maxStates: null,
          isDeterministic: null,
          groupAssignmentProblems: [{ groupId: 'g2' }],
        },
        submissions: [],
      },
    ]);

    const req = new NextRequest('http://localhost/api/assignments/a1/problems', {
      headers: { authorization: 'Bearer test-token' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.map((b: any) => b.id);
    expect(ids).toContain('p-unassigned');
    expect(ids).toContain('p-g1');
    expect(ids).not.toContain('p-g2');

    const solved = body.find((b: any) => b.id === 'p-g1');
    expect(solved.solved).toBe(true);
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

  it('group assignment: user not in a group sees only unassigned problems', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1', isGroup: true });
    prismaMock.groupRoster.findFirst.mockResolvedValue(null); // user not in a group

    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p-unassigned',
          title: 'Unassigned',
          description: null,
          type: 'FA',
          maxStates: null,
          isDeterministic: null,
          groupAssignmentProblems: [],
        },
        submissions: [],
      },
      {
        problem: {
          id: 'p-g1',
          title: 'Group 1 Problem',
          description: null,
          type: 'FA',
          maxStates: null,
          isDeterministic: null,
          groupAssignmentProblems: [{ groupId: 'g1' }],
        },
        submissions: [],
      },
    ]);

    const req = new NextRequest('http://localhost/api/assignments/a1/problems', {
      headers: { authorization: 'Bearer test-token' },
    });
    const res = await GET(req, { params: Promise.resolve({ id: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.map((b: any) => b.id);
    expect(ids).toEqual(['p-unassigned']);
  });
});
