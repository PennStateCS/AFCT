import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignmentProblem: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { PUT } from './route';

describe('PUT /api/courses/[id]/[aid]/problems/[pid]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      assignment: { courseId: 'c1' },
      problem: { title: 'Problem 1' },
    });
    prismaMock.assignmentProblem.update.mockResolvedValue({
      assignmentId: 'a1',
      problemId: 'p1',
      maxPoints: 20,
      maxSubmissions: 3,
      autograderEnabled: true,
    });
  });

  it('returns 403 when user is unauthorized', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });

    const req = new Request('http://localhost/api/courses/c1/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid payload', async () => {
    const req = new Request('http://localhost/api/courses/c1/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 when assignment problem link is missing', async () => {
    prismaMock.assignmentProblem.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(404);
  });

  it('updates assignment problem settings', async () => {
    const req = new Request('http://localhost/api/courses/c1/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 25, maxSubmissions: -1, autograderEnabled: false }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(200);

    expect(prismaMock.assignmentProblem.update).toHaveBeenCalledWith({
      where: {
        assignmentId_problemId: {
          assignmentId: 'a1',
          problemId: 'p1',
        },
      },
      data: {
        maxPoints: 25,
        maxSubmissions: -1,
        autograderEnabled: false,
      },
      select: {
        assignmentId: true,
        problemId: true,
        maxPoints: true,
        maxSubmissions: true,
        autograderEnabled: true,
      },
    });
  });

  it('returns 400 for an invalid JSON body', async () => {
    const req = new Request('http://localhost/api/courses/c1/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body.');
  });

  it('still succeeds when activity logging fails', async () => {
    activityLogMock.mockRejectedValue(new Error('log down'));

    const req = new Request('http://localhost/api/courses/c1/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(200);
  });

  it('returns 404 when the link belongs to a different course', async () => {
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      assignment: { courseId: 'other-course' },
      problem: { title: 'Problem 1' },
    });

    const req = new Request('http://localhost/api/courses/c1/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the update fails', async () => {
    prismaMock.assignmentProblem.update.mockRejectedValue(new Error('db down'));

    const req = new Request('http://localhost/api/courses/c1/a1/problems/p1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ maxPoints: 10, maxSubmissions: 2, autograderEnabled: true }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: 'c1', aid: 'a1', pid: 'p1' }) });
    expect(res.status).toBe(500);
  });
});
