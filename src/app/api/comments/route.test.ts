import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignment: {
    findUnique: vi.fn(),
  },
  roster: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  problem: {
    findFirst: vi.fn(),
  },
  comment: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST, GET, DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/comments', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hi', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('creates a comment and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
    prismaMock.comment.create.mockResolvedValue({
      id: 'cm1',
      content: 'Hello',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      roster: {
        role: 'STUDENT',
        user: { id: 'u1', firstName: 'A', lastName: 'B', avatar: null, role: 'STUDENT' },
      },
    });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('allows admin to add comment without roster entry', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique.mockResolvedValue(null);
    prismaMock.roster.create.mockResolvedValue({ id: 'r-admin', role: 'ADMIN' });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
    prismaMock.comment.create.mockResolvedValue({
      id: 'cm-admin',
      content: 'Admin note',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      roster: {
        role: 'ADMIN',
        user: { id: 'admin-1', firstName: 'Admin', lastName: 'User', avatar: null, role: 'ADMIN' },
      },
    });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Admin note', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(prismaMock.roster.create).toHaveBeenCalled();
    expect(prismaMock.comment.create).toHaveBeenCalled();
  });

  it('returns 404 when assignment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 403 when user not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 404 when problem not in course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.problem.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Hello', assignmentId: 'a1', problemId: 'p1' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 when student not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique.mockResolvedValueOnce({ id: 'r1' }).mockResolvedValueOnce(null); // student lookup
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Note',
        assignmentId: 'a1',
        problemId: 'p1',
        studentId: 's1',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('creates comment about specific student', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique
      .mockResolvedValueOnce({ id: 'r1' })
      .mockResolvedValueOnce({ id: 'r-student' });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', courseId: 'c1' });
    prismaMock.comment.create.mockResolvedValue({
      id: 'cm1',
      content: 'Note about student',
      createdAt: new Date(),
      roster: {
        role: 'FACULTY',
        user: { id: 'u1', firstName: 'F', lastName: 'A', avatar: null, role: 'FACULTY' },
      },
    });

    const req = new NextRequest('http://localhost/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'Note about student',
        assignmentId: 'a1',
        problemId: 'p1',
        studentId: 's1',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          aboutStudentId: 's1',
        }),
      }),
    );
  });
});

describe('GET /api/comments', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments?assignmentId=a1&problemId=p1');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when params missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/comments?assignmentId=a1');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when assignment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments?assignmentId=a1&problemId=p1');
    const res = await GET(req);
    expect(res.status).toBe(404);
  });

  it('returns 403 when user not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments?assignmentId=a1&problemId=p1');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('fetches all comments for assignment/problem', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.comment.findMany.mockResolvedValue([
      {
        id: 'cm1',
        content: 'Comment 1',
        createdAt: new Date(),
        roster: {
          role: 'STUDENT',
          user: { id: 'u1', firstName: 'A', lastName: 'B', avatar: null, role: 'STUDENT' },
        },
      },
    ]);

    const req = new NextRequest('http://localhost/api/comments?assignmentId=a1&problemId=p1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveLength(1);
  });

  it('filters comments by studentId', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.comment.findMany.mockResolvedValue([]);

    const req = new NextRequest(
      'http://localhost/api/comments?assignmentId=a1&problemId=p1&studentId=s1',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(prismaMock.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.any(Array),
        }),
      }),
    );
  });

  it('supports assignment-scope fetch for student without problemId', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findUnique.mockResolvedValue({ id: 'r1' });
    prismaMock.comment.findMany.mockResolvedValue([]);

    const req = new NextRequest(
      'http://localhost/api/comments?assignmentId=a1&studentId=s1&scope=assignment',
    );
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(prismaMock.comment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assignmentId: 'a1',
          OR: expect.any(Array),
        }),
      }),
    );
  });
});

describe('DELETE /api/comments', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when commentId missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/comments', { method: 'DELETE' });
    const res = await DELETE(req);
    expect(res.status).toBe(400);
  });

  it('deletes a comment and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'cm1',
      assignmentId: 'a1',
      problemId: 'p1',
      aboutStudentId: null,
      roster: { user: { id: 'u1' } },
      assignment: { courseId: 'c1' },
    });

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);

    expect(res.status).toBe(200);
    expect(prismaMock.comment.delete).toHaveBeenCalledWith({ where: { id: 'cm1' } });
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 404 when comment not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.comment.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(404);
  });

  it('allows owner to delete own comment', async () => {
    authMock.mockResolvedValue({ user: { id: 'owner-id', role: 'STUDENT' } });
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'cm1',
      assignmentId: 'a1',
      problemId: 'p1',
      aboutStudentId: null,
      roster: { user: { id: 'owner-id' } },
      assignment: { courseId: 'c1' },
    });

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });

  it('allows faculty to delete any comment', async () => {
    authMock.mockResolvedValue({ user: { id: 'fac-1', role: 'FACULTY' } });
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'cm1',
      assignmentId: 'a1',
      problemId: 'p1',
      aboutStudentId: null,
      roster: { user: { id: 'other-user' } },
      assignment: { courseId: 'c1' },
    });

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(200);
  });

  it('returns 403 when student tries to delete others comment', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'cm1',
      assignmentId: 'a1',
      problemId: 'p1',
      aboutStudentId: null,
      roster: { user: { id: 'other-user' } },
      assignment: { courseId: 'c1' },
    });
    prismaMock.roster.findUnique.mockResolvedValue({ role: 'STUDENT' });

    const req = new NextRequest('http://localhost/api/comments?commentId=cm1', {
      method: 'DELETE',
    });
    const res = await DELETE(req);
    expect(res.status).toBe(403);
  });
});
