import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignmentProblem: { findUnique: vi.fn() },
  assignmentProblemGrade: {
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
    upsert: vi.fn(),
  },
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
    authMock.mockResolvedValue({ user: { id: 'staff-1', role: 'FACULTY' } });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      assignment: { courseId: defaultParams.id },
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
        },
        update: {
          grade: 90,
          feedback: 'Great',
        },
      });
      await expect(res.json()).resolves.toEqual({
        grade: 90,
        feedback: 'Updated',
        updatedAt: '2026-02-17T12:00:00.000Z',
      });
    });
  });
});
