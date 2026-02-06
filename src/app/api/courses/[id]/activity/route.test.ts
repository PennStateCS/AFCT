import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  course: { findFirst: vi.fn() },
  activityLog: { findMany: vi.fn(), count: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/[id]/activity', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/activity');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 when course not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/activity');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('returns activity logs', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findFirst.mockResolvedValue({ id: 'c1' });
    prismaMock.activityLog.findMany.mockResolvedValue([{ id: 'log1' }]);
    prismaMock.activityLog.count.mockResolvedValue(1);

    const req = new NextRequest('http://localhost/api/courses/c1/activity?limit=10&offset=0');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activities).toHaveLength(1);
    expect(body.totalCount).toBe(1);
  });
});
