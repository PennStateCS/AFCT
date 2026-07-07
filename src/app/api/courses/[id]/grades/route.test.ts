import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn(), findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  assignment: { findMany: vi.fn() },
  assignmentProblemGrade: { groupBy: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  activityLogMock.mockResolvedValue(undefined);
});

describe('GET /api/courses/[id]/grades', () => {
  it('returns 400 when course ID missing', async () => {
    const req = new NextRequest('http://localhost/api/courses//grades');
    const res = await GET(req, { params: Promise.resolve({ id: '' }) });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when role is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.roster.findMany).not.toHaveBeenCalled();
  });

  it('returns grade matrix for staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1', role: 'STUDENT' }]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 's1', firstName: 'A', lastName: 'B', email: 's1@example.com', avatar: null },
    ]);
    prismaMock.assignment.findMany.mockResolvedValue([
      { id: 'a1', title: 'A1', dueDate: '2025-01-01', problems: [{ maxPoints: 10 }] },
    ]);
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
      { studentId: 's1', assignmentId: 'a1', _sum: { grade: 95 } },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.students).toEqual([
      { id: 's1', firstName: 'A', lastName: 'B', email: 's1@example.com', avatar: null },
    ]);
    expect(body.assignments).toEqual([
      { id: 'a1', title: 'A1', maxPoints: 10, dueDate: '2025-01-01' },
    ]);
    expect(body.grades).toEqual({ s1: { a1: 95 } });
  });

  it('fills nulls when no gradeRows exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.roster.findMany.mockResolvedValue([
      { userId: 's1', role: 'STUDENT' },
      { userId: 's2', role: 'STUDENT' },
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 's1', firstName: 'A', lastName: 'B', email: 's1@example.com', avatar: null },
      { id: 's2', firstName: 'C', lastName: 'D', email: 's2@example.com', avatar: null },
    ]);
    prismaMock.assignment.findMany.mockResolvedValue([
      { id: 'a1', title: 'A1', dueDate: '2025-01-01', problems: [{ maxPoints: 10 }] },
      { id: 'a2', title: 'A2', dueDate: '2025-02-01', problems: [{ maxPoints: 20 }] },
    ]);
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grades).toEqual({
      s1: { a1: null, a2: null },
      s2: { a1: null, a2: null },
    });
  });

  it('returns empty grade matrix without groupBy when no assignments exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1', role: 'STUDENT' }]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 's1', firstName: 'A', lastName: 'B', email: 's1@example.com', avatar: null },
    ]);
    prismaMock.assignment.findMany.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.students).toHaveLength(1);
    expect(body.assignments).toEqual([]);
    expect(body.grades).toEqual({ s1: {} });
    expect(prismaMock.assignmentProblemGrade.groupBy).not.toHaveBeenCalled();
  });

  it('returns an empty matrix and skips the user lookup when the roster is empty', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.roster.findMany.mockResolvedValue([]);
    prismaMock.assignment.findMany.mockResolvedValue([
      { id: 'a1', title: 'A1', dueDate: '2025-01-01', problems: [{ maxPoints: 10 }] },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.students).toEqual([]);
    expect(body.grades).toEqual({});
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
    expect(prismaMock.assignmentProblemGrade.groupBy).not.toHaveBeenCalled();
  });

  it('coerces null summed grades to 0 and ignores rows for unknown students', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1', role: 'STUDENT' }]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 's1', firstName: 'A', lastName: 'B', email: 's1@example.com', avatar: null },
    ]);
    prismaMock.assignment.findMany.mockResolvedValue([
      { id: 'a1', title: 'A1', dueDate: '2025-01-01', problems: [{ maxPoints: 10 }] },
    ]);
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
      { studentId: 's1', assignmentId: 'a1', _sum: { grade: null } },
      { studentId: 'ghost', assignmentId: 'a1', _sum: { grade: 5 } },
    ]);

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grades).toEqual({ s1: { a1: 0 } });
  });

  it('returns 500 when a query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.roster.findMany.mockRejectedValue(new Error('db down'));

    const req = new NextRequest('http://localhost/api/courses/c1/grades');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });
});

// Helper: a JSON POST request to the export-log endpoint.
const postReq = (body?: unknown) =>
  new NextRequest('http://localhost/api/courses/c1/grades', {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });

describe('POST /api/courses/[id]/grades (export log)', () => {
  it('returns 400 when course ID missing', async () => {
    const res = await POST(postReq({}), { params: Promise.resolve({ id: '' }) });
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(postReq({}), { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 and logs a denial when the caller is not course staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await POST(postReq({}), { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'GRADES_EXPORT_DENIED', severity: 'SECURITY' }),
    );
  });

  it('records the export with the provided scope metadata', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await POST(
      postReq({ platform: 'canvas', wholeGradebook: true, assignmentCount: 3, studentCount: 25 }),
      { params: Promise.resolve({ id: 'c1' }) },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'GRADES_EXPORTED',
        severity: 'INFO',
        courseId: 'c1',
        metadata: expect.objectContaining({
          platform: 'canvas',
          wholeGradebook: true,
          assignmentCount: 3,
          studentCount: 25,
        }),
      }),
    );
  });

  it('applies defaults for a missing/invalid body (unknown platform, zero counts)', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN', isAdmin: true } });

    // No body at all → req.json() rejects and is caught → {} → all defaults.
    const res = await POST(postReq(), { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'GRADES_EXPORTED',
        metadata: expect.objectContaining({
          platform: 'unknown',
          wholeGradebook: false,
          assignmentCount: 0,
          studentCount: 0,
        }),
      }),
    );
  });

  it('returns 500 and logs an error when recording the export fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    // First call (GRADES_EXPORTED) throws; the catch's error-log call then succeeds.
    activityLogMock.mockRejectedValueOnce(new Error('log down'));

    const res = await POST(postReq({}), { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'GRADES_EXPORT_ERROR', severity: 'ERROR' }),
    );
    consoleSpy.mockRestore();
  });
});
