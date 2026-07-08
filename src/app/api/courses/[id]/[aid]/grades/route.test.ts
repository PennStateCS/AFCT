import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
  assignmentProblemGrade: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const canManageCourseMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/permissions', () => ({ canManageCourse: canManageCourseMock }));

import { POST } from './route';

const defaultParams = { id: 'course-1', aid: 'assignment-1' };

const buildRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/courses/course-1/assignment-1/grades', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('POST /api/courses/[id]/[aid]/grades', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
    canManageCourseMock.mockResolvedValue(true);
    prismaMock.assignment.findFirst.mockResolvedValue({ id: defaultParams.aid });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      { problemId: 'p1', maxPoints: 100 },
      { problemId: 'p2', maxPoints: 100 },
      { problemId: 'p3', maxPoints: 100 },
    ]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
    // $transaction here receives an ARRAY of prisma promises; just resolve it.
    prismaMock.$transaction.mockResolvedValue([]);
    prismaMock.assignmentProblemGrade.upsert.mockReturnValue({ __op: 'upsert' });
    prismaMock.assignmentProblemGrade.deleteMany.mockReturnValue({ __op: 'deleteMany' });
    activityLogMock.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(buildRequest({ studentId: 's1', grades: { p1: 10 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(401);
    expect(prismaMock.assignment.findFirst).not.toHaveBeenCalled();
  });

  it('returns 403 and audits the denial when canManageCourse is false', async () => {
    canManageCourseMock.mockResolvedValue(false);

    const res = await POST(buildRequest({ studentId: 's1', grades: { p1: 10 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledTimes(1);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'PROBLEM_GRADE_UPDATE_DENIED', severity: 'SECURITY' }),
    );
    expect(prismaMock.assignment.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when the assignment is not found for the course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await POST(buildRequest({ studentId: 's1', grades: { p1: 10 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(404);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 when studentId is missing', async () => {
    const res = await POST(buildRequest({ grades: { p1: 10 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(400);
    expect(prismaMock.assignment.findFirst).not.toHaveBeenCalled();
  });

  it('returns 400 when grades is not an object', async () => {
    const res = await POST(buildRequest({ studentId: 's1', grades: [1, 2, 3] }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown problemId', async () => {
    const res = await POST(buildRequest({ studentId: 's1', grades: { unknown: 10 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 for a grade out of range', async () => {
    const res = await POST(buildRequest({ studentId: 's1', grades: { p1: 150 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric grade', async () => {
    const res = await POST(buildRequest({ studentId: 's1', grades: { p1: 'ten' } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('applies only changed problems: upserts a change, clears a null, skips unchanged', async () => {
    // Existing: p1=50, p2=70, p3 ungraded.
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      { problemId: 'p1', grade: 50 },
      { problemId: 'p2', grade: 70 },
    ]);

    // Payload: p1 -> 90 (change), p2 -> null (clear), p3 -> null (unchanged: still ungraded).
    const res = await POST(
      buildRequest({ studentId: 's1', grades: { p1: 90, p2: null, p3: null } }),
      { params: Promise.resolve(defaultParams) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, changed: 2 });

    // p1 upserted with grade only (feedback preserved on update).
    expect(prismaMock.assignmentProblemGrade.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.assignmentProblemGrade.upsert).toHaveBeenCalledWith({
      where: {
        assignmentId_problemId_studentId: {
          assignmentId: defaultParams.aid,
          problemId: 'p1',
          studentId: 's1',
        },
      },
      create: {
        assignmentId: defaultParams.aid,
        problemId: 'p1',
        studentId: 's1',
        grade: 90,
        feedback: null,
      },
      update: { grade: 90 },
    });
    // Feedback-preservation: update must NOT touch feedback.
    const upsertArg = prismaMock.assignmentProblemGrade.upsert.mock.calls[0][0];
    expect(upsertArg.update).not.toHaveProperty('feedback');

    // p2 cleared via deleteMany.
    expect(prismaMock.assignmentProblemGrade.deleteMany).toHaveBeenCalledTimes(1);
    expect(prismaMock.assignmentProblemGrade.deleteMany).toHaveBeenCalledWith({
      where: { assignmentId: defaultParams.aid, problemId: 'p2', studentId: 's1' },
    });

    // The $transaction received exactly the two built operations.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const ops = prismaMock.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(2);
  });

  it('returns changed: 0 with no writes when payload matches existing grades', async () => {
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      { problemId: 'p1', grade: 50 },
    ]);

    const res = await POST(buildRequest({ studentId: 's1', grades: { p1: 50 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, changed: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.assignmentProblemGrade.upsert).not.toHaveBeenCalled();
    expect(prismaMock.assignmentProblemGrade.deleteMany).not.toHaveBeenCalled();
  });
});
