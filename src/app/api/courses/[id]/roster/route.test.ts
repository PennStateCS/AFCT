import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  roster: { upsert: vi.fn(), findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // Default to a signed-in caller; authorization comes from the course roster.
  authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: false } });
  // Default: caller not enrolled (denied); authorized tests grant a course role.
  prismaMock.roster.findFirst.mockResolvedValue(null);
  // Default: course is not archived; archived-block tests override.
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
});

describe('POST /api/courses/[id]/roster', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
    expect(prismaMock.roster.upsert).not.toHaveBeenCalled();
  });

  it('returns 403 and logs a denial when the caller is not course staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu', isAdmin: false } });
    // roster.findFirst defaults to null in beforeEach → caller has no course role.

    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.roster.upsert).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'COURSE_ENROLL_DENIED', severity: 'SECURITY' }),
    );
  });

  it('returns 409 when the course is archived', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(409);
    expect(prismaMock.roster.upsert).not.toHaveBeenCalled();
  });

  it('returns 400 when userId missing', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 404 when user not found', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the target user is inactive (caller is authorized)', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', inactive: true });

    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(409);
  });

  it('enrolls user and logs activity', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', inactive: false });

    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.roster.upsert).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('adds a new member as STUDENT but never re-roles an existing member', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', inactive: false });

    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    // New rows are STUDENT; the update branch is empty so an already-enrolled FACULTY/TA
    // member is never silently demoted by an "enroll" call (that's the role-change route).
    expect(prismaMock.roster.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: 'STUDENT' }),
        update: {},
      }),
    );
  });

  it('returns 500 when the roster upsert fails', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', inactive: false });
    prismaMock.roster.upsert.mockRejectedValue(new Error('db down'));

    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
  });

  it('returns 500 and logs "unknown error" when a non-Error is thrown', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', inactive: false });
    // Throw a non-Error value to exercise the `: 'unknown error'` branch (line 97).
    prismaMock.roster.upsert.mockRejectedValueOnce('boom');

    const req = new Request('http://localhost/api/courses/c1/roster', {
      method: 'POST',
      body: JSON.stringify({ userId: 'u1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'COURSE_ENROLL_ERROR',
        metadata: expect.objectContaining({ error: 'unknown error' }),
      }),
    );
  });
});
