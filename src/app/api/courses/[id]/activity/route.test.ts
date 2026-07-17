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

  it('denies an enrolled STUDENT (staff-only feed)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1' });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });

    const req = new NextRequest('http://localhost/api/courses/c1/activity');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('allows staff and returns default pagination payload', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1' });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
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
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.activityLog.findMany.mockResolvedValue([{ id: 'log1' }]);
    prismaMock.activityLog.count.mockResolvedValue(1);

    const req = new NextRequest('http://localhost/api/courses/c1/activity?limit=10&offset=0');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities).toHaveLength(1);
    expect(body.totalCount).toBe(1);
  });

  it('shows admin + staff course-content any time (incl. non-enrolled admins); clips others', async () => {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-05-01');
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1', startDate, endDate });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.roster.findMany.mockResolvedValue([
      { userId: 'fac', role: 'FACULTY' },
      { userId: 'stu', role: 'STUDENT' },
    ]);
    prismaMock.activityLog.findMany.mockResolvedValue([]);
    prismaMock.activityLog.count.mockResolvedValue(0);

    const req = new NextRequest('http://localhost/api/courses/c1/activity');
    await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    const whereArg = prismaMock.activityLog.findMany.mock.calls[0][0].where;
    const inDates = { timestamp: { gte: startDate, lte: endDate } };
    const actorClause = whereArg.OR[0].AND[1];

    // Any admin — enrolled or not — on course content, any time (covers create/edit/delete).
    expect(actorClause.OR).toContainEqual({ user: { isAdmin: true } });
    // Enrolled Faculty/TA, any time.
    expect(actorClause.OR).toContainEqual({ userId: { in: ['fac'] } });
    // Other enrolled members, only within the course dates.
    expect(actorClause.OR).toContainEqual({ AND: [{ userId: { in: ['fac', 'stu'] } }, inDates] });
  });

  it('shows member (non-admin) logins only within the course dates', async () => {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-05-01');
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1', startDate, endDate });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.roster.findMany.mockResolvedValue([
      { userId: 'fac', role: 'FACULTY' },
      { userId: 'stu', role: 'STUDENT' },
    ]);
    prismaMock.activityLog.findMany.mockResolvedValue([]);
    prismaMock.activityLog.count.mockResolvedValue(0);

    const req = new NextRequest('http://localhost/api/courses/c1/activity');
    await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    const loginBranch = prismaMock.activityLog.findMany.mock.calls[0][0].where.OR[1];
    expect(loginBranch.AND).toContainEqual({ action: { contains: 'LOGIN' } });
    expect(loginBranch.AND).toContainEqual({ userId: { in: ['fac', 'stu'] } });
    // Admin logins are excluded (only their course edits are relevant).
    expect(loginBranch.AND).toContainEqual({ user: { isAdmin: false } });
    expect(loginBranch.AND).toContainEqual({ timestamp: { gte: startDate, lte: endDate } });
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
