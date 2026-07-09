import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
  assignmentProblemGrade: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const canManageCourseMock = vi.hoisted(() => vi.fn());
const canAccessCourseMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/permissions', () => ({
  canManageCourse: canManageCourseMock,
  canAccessCourse: canAccessCourseMock,
}));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST } from './route';

const defaultParams = { id: 'course-1', aid: 'assignment-1', studentId: 'student-1' };

describe('GET /api/courses/[id]/[aid]/problem-grades/[studentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManageCourseMock.mockResolvedValue(true);
    canAccessCourseMock.mockResolvedValue(true);
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
    canManageCourseMock.mockResolvedValue(false);

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

describe('POST /api/courses/[id]/[aid]/problem-grades/[studentId]', () => {
  const buildRequest = (body: unknown) =>
    new NextRequest('http://localhost', {
      method: 'POST',
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    canManageCourseMock.mockResolvedValue(true);
    canAccessCourseMock.mockResolvedValue(true);
    authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: defaultParams.aid });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      { problemId: 'prob-1', maxPoints: 10 },
      { problemId: 'prob-2', maxPoints: 20 },
      { problemId: 'prob-3', maxPoints: 30 },
    ]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
    // $transaction receives an array of prisma promises; resolve it and let the
    // individual upsert/deleteMany mocks record their own calls.
    prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => {
      await Promise.all(ops as Promise<unknown>[]);
      return [];
    });
    prismaMock.assignmentProblemGrade.upsert.mockResolvedValue({});
    prismaMock.assignmentProblemGrade.deleteMany.mockResolvedValue({ count: 1 });
    activityLogMock.mockResolvedValue(undefined);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(buildRequest({ grades: { 'prob-1': 5 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 and audits the denial when the caller cannot manage the course', async () => {
    canManageCourseMock.mockResolvedValue(false);

    const res = await POST(buildRequest({ grades: { 'prob-1': 5 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'PROBLEM_GRADE_UPDATE_DENIED', severity: 'SECURITY' }),
    );
    expect(prismaMock.assignment.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when the assignment is not in the course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await POST(buildRequest({ grades: { 'prob-1': 5 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(404);
  });

  it('returns 400 when grades is missing or not an object', async () => {
    const missing = await POST(buildRequest({}), {
      params: Promise.resolve(defaultParams),
    });
    expect(missing.status).toBe(400);

    const notObject = await POST(buildRequest({ grades: [1, 2, 3] }), {
      params: Promise.resolve(defaultParams),
    });
    expect(notObject.status).toBe(400);
  });

  it('returns 400 for an unknown problem id', async () => {
    const res = await POST(buildRequest({ grades: { nope: 5 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 for an out-of-range grade', async () => {
    const res = await POST(buildRequest({ grades: { 'prob-1': 999 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('applies only the changed problems, preserving feedback and unchanged grades', async () => {
    // Existing: prob-1=5, prob-2=8, prob-3=12.
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      { problemId: 'prob-1', grade: 5 },
      { problemId: 'prob-2', grade: 8 },
      { problemId: 'prob-3', grade: 12 },
    ]);

    // Change prob-1 → 9 (upsert), clear prob-2 (null → delete), leave prob-3 at 12.
    const res = await POST(
      buildRequest({ grades: { 'prob-1': 9, 'prob-2': null, 'prob-3': 12 } }),
      { params: Promise.resolve(defaultParams) },
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, changed: 2 });

    // Exactly one upsert (prob-1) and one deleteMany (prob-2).
    expect(prismaMock.assignmentProblemGrade.upsert).toHaveBeenCalledTimes(1);
    expect(prismaMock.assignmentProblemGrade.deleteMany).toHaveBeenCalledTimes(1);

    // $transaction received exactly the two changed ops.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const txnOps = prismaMock.$transaction.mock.calls[0][0] as unknown[];
    expect(txnOps).toHaveLength(2);

    // Upsert targets prob-1 and its `update` sets only grade (no feedback).
    const upsertArg = prismaMock.assignmentProblemGrade.upsert.mock.calls[0][0];
    expect(upsertArg).toMatchObject({
      where: {
        assignmentId_problemId_studentId: {
          assignmentId: defaultParams.aid,
          problemId: 'prob-1',
          studentId: defaultParams.studentId,
        },
      },
      update: { grade: 9 },
    });
    expect(upsertArg.update).not.toHaveProperty('feedback');

    // deleteMany clears prob-2.
    expect(prismaMock.assignmentProblemGrade.deleteMany).toHaveBeenCalledWith({
      where: {
        assignmentId: defaultParams.aid,
        problemId: 'prob-2',
        studentId: defaultParams.studentId,
      },
    });
  });

  it('returns changed: 0 and writes nothing when the payload matches existing grades', async () => {
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      { problemId: 'prob-1', grade: 5 },
      { problemId: 'prob-2', grade: 8 },
    ]);

    const res = await POST(buildRequest({ grades: { 'prob-1': 5, 'prob-2': 8 } }), {
      params: Promise.resolve(defaultParams),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, changed: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.assignmentProblemGrade.upsert).not.toHaveBeenCalled();
    expect(prismaMock.assignmentProblemGrade.deleteMany).not.toHaveBeenCalled();
  });
});
