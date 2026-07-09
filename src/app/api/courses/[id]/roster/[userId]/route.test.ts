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
const isAdminMock = vi.hoisted(() => vi.fn());
const canManageCourseMock = vi.hoisted(() => vi.fn());
const canAccessCourseMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/permissions', () => ({
  isAdmin: isAdminMock,
  canManageCourse: canManageCourseMock,
  canAccessCourse: canAccessCourseMock,
}));

import { DELETE, GET, PATCH } from './route';

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so each test's mockResolvedValueOnce queue
  // starts empty — the roster route makes several findFirst calls and leaked
  // queue entries would otherwise cascade between tests.
  vi.resetAllMocks();
  // Sensible defaults; individual tests override. The DELETE/PATCH wrappers gate on
  // canManageCourse (admin or course FACULTY); the DELETE handler consults isAdmin
  // for the faculty-can't-remove-faculty rule.
  canManageCourseMock.mockResolvedValue(true);
  canAccessCourseMock.mockResolvedValue(true);
  isAdminMock.mockReturnValue(false);
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
    // A non-staff member reading their OWN entry: allowed without staff rights.
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    canManageCourseMock.mockResolvedValue(false);
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

  it('returns 403 when a non-staff member reads another member’s entry', async () => {
    // Enrolled (wrapper passes) but not staff, targeting a different user.
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    canManageCourseMock.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2');
    const res = await GET(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
    // Must not leak the target's profile.
    expect(prismaMock.roster.findFirst).not.toHaveBeenCalled();
  });

  it('handles server errors gracefully', async () => {
    // Authorized, but the roster lookup throws — the handler's catch returns 500.
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.roster.findFirst.mockRejectedValue(new Error('DB error'));

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
    canManageCourseMock.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when a TA tries to remove a user', async () => {
    // The wrapper gates on FACULTY-or-admin, so a TA never reaches the handler.
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    canManageCourseMock.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when a faculty member tries to remove another faculty member', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    canManageCourseMock.mockResolvedValue(true);
    isAdminMock.mockReturnValue(false);
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' }); // target

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
  });

  it('lets a global admin remove a faculty member', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    canManageCourseMock.mockResolvedValue(true);
    isAdminMock.mockReturnValue(true);
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' }); // target
    prismaMock.assignment.findMany.mockResolvedValue([]);
    prismaMock.roster.count.mockResolvedValue(2); // not the only faculty
    prismaMock.roster.deleteMany.mockResolvedValue({ count: 1 });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(200);
  });

  it('returns 400 when user has submissions', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    isAdminMock.mockReturnValue(true);
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' }); // target
    prismaMock.assignment.findMany.mockResolvedValue([{ id: 'a1' }]);
    prismaMock.submission.findFirst.mockResolvedValue({ id: 's1' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('submissions');
  });

  it('returns 400 when removing only faculty member', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    isAdminMock.mockReturnValue(true);
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' }); // target
    prismaMock.assignment.findMany.mockResolvedValue([]);
    prismaMock.roster.count.mockResolvedValue(1);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('only faculty member');
  });

  it('removes roster entry when allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    isAdminMock.mockReturnValue(true);
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' }); // target
    prismaMock.assignment.findMany.mockResolvedValue([]);
    prismaMock.roster.deleteMany.mockResolvedValue({ count: 1 });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(200);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('handles server errors gracefully', async () => {
    // Authorized, but the target lookup throws — the handler's catch returns 500.
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    isAdminMock.mockReturnValue(true);
    prismaMock.roster.findFirst.mockRejectedValue(new Error('DB error'));

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
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    canManageCourseMock.mockResolvedValue(true);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'INVALID' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(400);
  });

  it('returns 403 when user lacks permission', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'TA' } });
    canManageCourseMock.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'TA' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1', userId: 'u2' }) });

    expect(res.status).toBe(403);
  });

  it('updates role when allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    canManageCourseMock.mockResolvedValue(true);
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT' }); // target
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
