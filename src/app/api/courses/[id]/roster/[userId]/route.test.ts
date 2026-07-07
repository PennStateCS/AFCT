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
  // resetAllMocks (not clearAllMocks) so each test's mockResolvedValueOnce queue
  // starts empty — the roster route makes several findFirst calls and leaked
  // queue entries would otherwise cascade between tests.
  vi.resetAllMocks();
});

describe('GET /api/courses/[id]/roster/[userId]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u1');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1', userId: 'u1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 when roster entry not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(404);
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

  it('resolves "me" to current user', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst
      .mockResolvedValueOnce({
        id: 'r1',
        role: 'STUDENT',
        user: { id: 'u1', firstName: 'A', lastName: 'B', email: 'u1@example.com', role: 'STUDENT' },
      })
      .mockResolvedValueOnce({ role: 'STUDENT' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/me');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1', userId: 'me' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.roster.user.id).toBe('u1');
  });

  it('handles server errors gracefully', async () => {
    authMock.mockRejectedValue(new Error('DB error'));

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u1');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1', userId: 'u1' }) });

    expect(res.status).toBe(500);
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

  it('returns 403 when TA tries to remove user', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when faculty tries to remove another faculty', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst
      .mockResolvedValueOnce({ role: 'FACULTY' })
      .mockResolvedValueOnce({ role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when course admin tries to remove another course admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst
      .mockResolvedValueOnce({ role: 'ADMIN' })
      .mockResolvedValueOnce({ role: 'ADMIN' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
  });

  it('returns 400 when user has submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ role: 'STUDENT' });
    prismaMock.assignment.findMany.mockResolvedValue([{ id: 'a1' }]);
    prismaMock.submission.findFirst.mockResolvedValue({ id: 's1' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('submissions');
  });

  it('returns 400 when removing only faculty member', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.roster.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ role: 'FACULTY' })
      .mockResolvedValueOnce({ role: 'FACULTY' });
    prismaMock.assignment.findMany.mockResolvedValue([]);
    prismaMock.roster.count.mockResolvedValue(1);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('only faculty member');
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

  it('handles server errors gracefully', async () => {
    authMock.mockRejectedValue(new Error('DB error'));

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(500);
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
