import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  course: { findFirst: vi.fn() },
  activityLog: { findMany: vi.fn(), count: vi.fn() },
  roster: { findFirst: vi.fn(), findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: caller not enrolled (denied); authorized tests grant a course role.
  prismaMock.roster.findFirst.mockResolvedValue(null);
  // Roster ids for the login-activity filter (empty by default).
  prismaMock.roster.findMany.mockResolvedValue([]);
});

describe('GET /api/courses/[id]/activity', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/activity');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 when a permitted caller hits a missing course', async () => {
    // Admin passes the access gate, then the handler's existence check returns 404.
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.course.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/activity');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 403 for non-privileged user not in roster', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1' });
    prismaMock.activityLog.findMany.mockResolvedValue([]);
    prismaMock.activityLog.count.mockResolvedValue(0);
    // roster.findFirst already defaults to null (denied) via beforeEach.

    const req = new NextRequest('http://localhost/api/courses/c1/activity');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('allows user when role is undefined and returns default pagination payload', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1' });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });
    prismaMock.activityLog.findMany.mockResolvedValue([{ id: 'log1' }]);
    prismaMock.activityLog.count.mockResolvedValue(80);

    const req = new NextRequest('http://localhost/api/courses/c1/activity');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasMore).toBe(true);
  });

  it('returns activity logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1' });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });
    prismaMock.activityLog.findMany.mockResolvedValue([{ id: 'log1' }]);
    prismaMock.activityLog.count.mockResolvedValue(1);

    const req = new NextRequest('http://localhost/api/courses/c1/activity?limit=10&offset=0');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities).toHaveLength(1);
    expect(body.totalCount).toBe(1);
  });

  it('maps roster member ids into the login-activity filter', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1' });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    // Non-empty roster so the `(r) => r.userId` mapper actually runs.
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 'm1' }, { userId: 'm2' }]);
    prismaMock.activityLog.findMany.mockResolvedValue([{ id: 'log1' }]);
    prismaMock.activityLog.count.mockResolvedValue(1);

    const req = new NextRequest('http://localhost/api/courses/c1/activity?limit=10&offset=0');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    // Verify the precomputed roster ids reached the WHERE clause.
    const whereArg = prismaMock.activityLog.findMany.mock.calls[0][0].where;
    const loginClause = whereArg.OR.find((c: { AND?: unknown[] }) => Array.isArray(c.AND));
    expect(loginClause.AND).toContainEqual({ userId: { in: ['m1', 'm2'] } });
  });

  it('returns 500 when activity query fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1' });
    prismaMock.activityLog.findMany.mockRejectedValue(new Error('boom'));

    const req = new NextRequest('http://localhost/api/courses/c1/activity?limit=10&offset=0');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
  });
});
