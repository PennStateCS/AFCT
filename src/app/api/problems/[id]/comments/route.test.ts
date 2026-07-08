import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  comment: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  problem: {
    findUnique: vi.fn(),
  },
  roster: {
    findFirst: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/problems/[id]/comments', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest(
      'http://localhost/api/problems/problem-1/comments?problemId=problem-1',
    );
    const res = await GET(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 400 when problemId missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });

    const req = new NextRequest('http://localhost/api/problems/problem-1/comments');
    const res = await GET(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 403 when the caller cannot access the problem course', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: false } });
    prismaMock.problem.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.roster.findFirst.mockResolvedValue(null); // not enrolled

    const req = new NextRequest(
      'http://localhost/api/problems/problem-1/comments?problemId=problem-1',
    );
    const res = await GET(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(403);
  });

  it('returns transformed comments', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1', isAdmin: true } });
    prismaMock.problem.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.comment.findMany.mockResolvedValue([
      {
        id: 'c1',
        content: 'Hello',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        roster: { user: { firstName: 'A', lastName: 'B', role: 'STUDENT' }, role: 'STUDENT' },
        problemId: 'problem-1',
      },
    ]);

    const req = new NextRequest(
      'http://localhost/api/problems/problem-1/comments?problemId=problem-1',
    );
    const res = await GET(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: 'c1',
        content: 'Hello',
        createdAt: '2025-01-01T00:00:00.000Z',
        authorName: 'A B',
        authorRole: 'STUDENT',
        problemId: 'problem-1',
      },
    ]);
  });
});

describe('POST /api/problems/[id]/comments', () => {
  it('returns 401 when not authenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/problems/problem-1/comments', {
      method: 'POST',
      body: JSON.stringify({ content: 'Hi' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 400 when content missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });

    const req = new NextRequest('http://localhost/api/problems/problem-1/comments', {
      method: 'POST',
      body: JSON.stringify({ content: '   ' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 404 when problem or assignment missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.problem.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/problems/problem-1/comments', {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user not enrolled', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.problem.findUnique.mockResolvedValue({
      id: 'problem-1',
      assignments: [
        {
          assignment: {
            id: 'a1',
            course: { id: 'c1' },
          },
        },
      ],
    });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/problems/problem-1/comments', {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(403);
  });

  it('creates a comment and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'user-1' } });
    prismaMock.problem.findUnique.mockResolvedValue({
      id: 'problem-1',
      assignments: [
        {
          assignment: {
            id: 'a1',
            course: { id: 'c1' },
          },
        },
      ],
    });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT' });
    prismaMock.comment.create.mockResolvedValue({
      id: 'c1',
      content: 'Hello',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      problemId: 'problem-1',
      roster: { user: { firstName: 'A', lastName: 'B', role: 'TA' }, role: 'TA' },
    });

    const req = new NextRequest('http://localhost/api/problems/problem-1/comments', {
      method: 'POST',
      body: JSON.stringify({ content: 'Hello' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'problem-1' }) });

    expect(res.status).toBe(201);
    expect(prismaMock.comment.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});
