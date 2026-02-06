import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  roster: {
    findFirst: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  assignment: {
    findMany: vi.fn(),
  },
  submission: {
    findFirst: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { DELETE, GET, PATCH } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/[id]/roster/[userId]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u1');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1', userId: 'u1' }) });

    expect(res.status).toBe(401);
  });

  it('returns roster data when found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst
      .mockResolvedValueOnce({
        id: 'r1',
        role: 'STUDENT',
        user: { id: 'u2', firstName: 'A', lastName: 'B', email: 'u2@example.com', role: 'STUDENT' },
      })
      .mockResolvedValueOnce({ role: 'ADMIN' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.roster).toBeTruthy();
    expect(body.viewerCourseRole).toBe('ADMIN');
  });
});

describe('DELETE /api/courses/[id]/roster/[userId]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when user lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
  });

  it('removes roster entry when allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ role: 'STUDENT' })
      .mockResolvedValueOnce({ role: 'STUDENT' });
    prismaMock.assignment.findMany.mockResolvedValue([]);
    prismaMock.roster.deleteMany.mockResolvedValue({ count: 1 });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(200);
    expect(activityLogMock).toHaveBeenCalled();
  });
});

describe('PATCH /api/courses/[id]/roster/[userId]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u1', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'TA' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', userId: 'u1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 400 when role invalid', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'INVALID' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(400);
  });

  it('returns 403 when user lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'TA' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
  });

  it('updates role when allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ id: 'r1', role: 'STUDENT' });
    prismaMock.roster.update.mockResolvedValue({ id: 'r1', role: 'TA' });
    prismaMock.roster.count.mockResolvedValue(2);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'TA' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(activityLogMock).toHaveBeenCalled();
  });
});
