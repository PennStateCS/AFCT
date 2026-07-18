import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  assignmentProblem: { findUnique: vi.fn() },
  assignmentProblemGrade: {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  },
  groupSet: { updateMany: vi.fn() },
  course: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET, POST } from './route';

const defaultParams = {
  id: 'course-1',
  aid: 'assignment-1',
  pid: 'problem-1',
  studentId: 'student-1',
};

describe('/api/courses/[id]/[aid]/problems/[pid]/grade/[studentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
    prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn(prismaMock),
    );
    authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      assignment: { courseId: defaultParams.id, isPublished: true },
      maxPoints: 100,
    });
    prismaMock.assignmentProblemGrade.findUnique.mockResolvedValue({
      grade: 80,
      feedback: 'Solid',
      updatedAt: new Date('2026-02-16T12:00:00.000Z'),
    });
    prismaMock.assignmentProblemGrade.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.assignmentProblemGrade.upsert.mockResolvedValue({
      grade: 90,
      feedback: 'Updated',
      updatedAt: new Date('2026-02-17T12:00:00.000Z'),
    });
  });

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      authMock.mockResolvedValue(null);

      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(401);
    });

    it('returns 403 when user is neither staff nor owner', async () => {
      authMock.mockResolvedValue({ user: { id: 'other', role: 'STUDENT' } });
      prismaMock.roster.findFirst.mockResolvedValue(null);

      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(403);
      expect(prismaMock.assignmentProblem.findUnique).not.toHaveBeenCalled();
    });

    it('returns 404 when the problem is not part of the course', async () => {
      prismaMock.assignmentProblem.findUnique.mockResolvedValue(null);

      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(404);
    });

    it('returns null grade payload when no grade exists', async () => {
      prismaMock.assignmentProblemGrade.findUnique.mockResolvedValue(null);

      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ grade: null, feedback: null });
    });

    it('returns stored grade information', async () => {
      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        grade: 80,
        feedback: 'Solid',
        updatedAt: '2026-02-16T12:00:00.000Z',
      });
    });

    it('lets the student read their own grade even without manage rights', async () => {
      // Student is enrolled (passes read access) and is the owner of the grade,
      // so canManageCourse is false but user.id === studentId keeps them allowed.
      authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
      prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { isPublished: true } });

      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      expect(prismaMock.assignmentProblem.findUnique).toHaveBeenCalled();
    });

    it('404-masks an unpublished assignment for the owning student', async () => {
      // Even reading their OWN grade, a student can't touch an unpublished assignment.
      authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
      prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { isPublished: true } });
      prismaMock.assignmentProblem.findUnique.mockResolvedValue({
        assignment: { courseId: defaultParams.id, isPublished: false },
        maxPoints: 100,
      });

      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(404);
    });

    it('returns 403 when an enrolled student reads someone else grade', async () => {
      // Enrolled as a plain student (read access granted) but not the owner and
      // not a manager -> hits the in-handler denial.
      authMock.mockResolvedValue({ user: { id: 'other-student', role: 'STUDENT' } });
      prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { isPublished: true } });

      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(403);
      expect(prismaMock.assignmentProblem.findUnique).not.toHaveBeenCalled();
    });

    it('coerces null grade and feedback fields to null', async () => {
      prismaMock.assignmentProblemGrade.findUnique.mockResolvedValue({
        grade: null,
        feedback: null,
        updatedAt: new Date('2026-02-16T12:00:00.000Z'),
      });

      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        grade: null,
        feedback: null,
        updatedAt: '2026-02-16T12:00:00.000Z',
      });
    });

    it('returns 500 when the grade lookup throws', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      prismaMock.assignmentProblem.findUnique.mockRejectedValueOnce(new Error('db down'));

      const res = await GET(new Request('http://localhost'), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(500);
      consoleSpy.mockRestore();
    });
  });

  describe('POST', () => {
    const buildRequest = (body: unknown) =>
      new NextRequest('http://localhost', {
        method: 'POST',
        body: JSON.stringify(body),
      });

    it('returns 401 when unauthenticated', async () => {
      authMock.mockResolvedValue(null);

      const res = await POST(buildRequest({ grade: 10 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-staff users', async () => {
      authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
      prismaMock.roster.findFirst.mockResolvedValue(null);

      const res = await POST(buildRequest({ grade: 10 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(403);
      expect(prismaMock.assignmentProblem.findUnique).not.toHaveBeenCalled();
    });

    it('returns 404 when assignment problem is missing', async () => {
      prismaMock.assignmentProblem.findUnique.mockResolvedValue(null);

      const res = await POST(buildRequest({ grade: 10 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(404);
    });

    it('locks the group set when a grade is entered on a group assignment', async () => {
      prismaMock.assignmentProblem.findUnique.mockResolvedValue({
        assignment: { courseId: defaultParams.id, isPublished: true, groupSetId: 'gs1' },
        maxPoints: 100,
      });

      const res = await POST(buildRequest({ grade: 90 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      expect(prismaMock.groupSet.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'gs1', lockedAt: null } }),
      );
    });

    it('locks the group set even when the grade is 0 (no truthiness on 0)', async () => {
      prismaMock.assignmentProblem.findUnique.mockResolvedValue({
        assignment: { courseId: defaultParams.id, isPublished: true, groupSetId: 'gs1' },
        maxPoints: 100,
      });
      prismaMock.assignmentProblemGrade.upsert.mockResolvedValue({
        grade: 0,
        feedback: null,
        updatedAt: new Date(),
      });

      const res = await POST(buildRequest({ grade: 0 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      // 0 is a real grade: it goes through the upsert path and stamps the lock.
      expect(prismaMock.assignmentProblemGrade.upsert).toHaveBeenCalled();
      expect(prismaMock.groupSet.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'gs1', lockedAt: null } }),
      );
    });

    it('rejects non-numeric grades', async () => {
      const res = await POST(buildRequest({ grade: 'ten' }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(400);
      expect(prismaMock.assignmentProblemGrade.upsert).not.toHaveBeenCalled();
    });

    it('rejects grades outside the allowed range', async () => {
      const res = await POST(buildRequest({ grade: 150 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(400);
    });

    it('deletes grades when grade is null', async () => {
      const res = await POST(buildRequest({ grade: null }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      expect(prismaMock.assignmentProblemGrade.deleteMany).toHaveBeenCalledWith({
        where: {
          assignmentId: defaultParams.aid,
          problemId: defaultParams.pid,
          studentId: defaultParams.studentId,
        },
      });
      await expect(res.json()).resolves.toEqual({ grade: null, feedback: null });
    });

    it('persists a valid grade and returns the saved record', async () => {
      const res = await POST(buildRequest({ grade: 90, feedback: 'Great' }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      expect(prismaMock.assignmentProblemGrade.upsert).toHaveBeenCalledWith({
        where: {
          assignmentId_problemId_studentId: {
            assignmentId: defaultParams.aid,
            problemId: defaultParams.pid,
            studentId: defaultParams.studentId,
          },
        },
        create: {
          assignmentId: defaultParams.aid,
          problemId: defaultParams.pid,
          studentId: defaultParams.studentId,
          grade: 90,
          feedback: 'Great',
          gradedManually: true,
        },
        update: {
          grade: 90,
          feedback: 'Great',
          gradedManually: true,
        },
      });
      await expect(res.json()).resolves.toEqual({
        grade: 90,
        feedback: 'Updated',
        updatedAt: '2026-02-17T12:00:00.000Z',
      });
    });

    it('clears a grade when there was no prior record', async () => {
      // existing is null -> previousGrade falls back to null in the audit metadata.
      prismaMock.assignmentProblemGrade.findUnique.mockResolvedValue(null);

      const res = await POST(buildRequest({ grade: null }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      expect(prismaMock.assignmentProblemGrade.deleteMany).toHaveBeenCalled();
    });

    it('saves a grade when there was no prior record and coerces null fields', async () => {
      // existing null -> previousGrade/feedbackChanged branches use the null fallback.
      prismaMock.assignmentProblemGrade.findUnique.mockResolvedValue(null);
      prismaMock.assignmentProblemGrade.upsert.mockResolvedValue({
        grade: null,
        feedback: null,
        updatedAt: new Date('2026-02-17T12:00:00.000Z'),
      });

      const res = await POST(buildRequest({ grade: 50 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        grade: null,
        feedback: null,
        updatedAt: '2026-02-17T12:00:00.000Z',
      });
    });

    it('returns 500 when saving the grade throws', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      prismaMock.assignmentProblemGrade.upsert.mockRejectedValueOnce(new Error('db down'));

      const res = await POST(buildRequest({ grade: 90 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(500);
      consoleSpy.mockRestore();
    });

    it('returns 500 when saving throws a non-Error value', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      prismaMock.assignmentProblemGrade.upsert.mockRejectedValueOnce('boom');

      const res = await POST(buildRequest({ grade: 90 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(500);
      consoleSpy.mockRestore();
    });

    it('returns 409 and writes nothing when the course is archived', async () => {
      prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

      const res = await POST(buildRequest({ grade: 90 }), {
        params: Promise.resolve(defaultParams),
      });

      expect(res.status).toBe(409);
      expect(prismaMock.assignmentProblemGrade.upsert).not.toHaveBeenCalled();
      expect(prismaMock.assignmentProblemGrade.deleteMany).not.toHaveBeenCalled();
    });
  });
});
