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

import { POST, DELETE } from './route';

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
});
