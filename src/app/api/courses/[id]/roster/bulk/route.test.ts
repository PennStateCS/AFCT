import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  roster: { findFirst: vi.fn() },
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
  // Default: caller not enrolled (denied); authorized tests grant a course role.
  prismaMock.roster.findFirst.mockResolvedValue(null);
  // Default: course is not archived; archived-block tests override.
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
});

describe('POST /api/courses/[id]/roster/bulk', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 409 when the course is archived', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(409);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('returns 400 when no users provided', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds: [] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('bulk enrolls users via upsert on the (courseId, userId) key', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const tx = { roster: { upsert: vi.fn() } };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(tx.roster.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId_userId: { courseId: 'c1', userId: 'u1' } },
        create: expect.objectContaining({ role: 'STUDENT' }),
        update: { role: 'STUDENT' },
      }),
    );
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('upserts every user to the STUDENT role', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });

    const tx = { roster: { upsert: vi.fn() } };
    prismaMock.$transaction.mockImplementation(async (cb: (client: typeof tx) => unknown) =>
      cb(tx),
    );

    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1', 'u2', 'u3', 'u4'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(tx.roster.upsert).toHaveBeenCalledTimes(4);
    expect(tx.roster.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ role: 'STUDENT' }),
        update: { role: 'STUDENT' },
      }),
    );
  });

  it('returns 400 when userIds is missing entirely (defaults to [])', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    // Body has no userIds → `(body?.userIds ?? [])` falls back to [] (branch at line 40).
    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(400);
  });

  it('filters out falsy user ids and returns 400 when none remain', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    // Empty strings survive String() but are dropped by filter(Boolean) → empty list (line 40).
    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['', ''] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(400);
  });

  it('returns 500 when enrollment transaction fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.$transaction.mockRejectedValue(new Error('tx failed'));

    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(500);
  });

  it('returns 500 and logs "unknown error" when a non-Error is thrown', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    // Throw a non-Error to exercise the `: 'unknown error'` branch (line 78).
    prismaMock.$transaction.mockRejectedValueOnce('boom');

    const req = new NextRequest('http://localhost/api/courses/c1/roster/bulk', {
      method: 'POST',
      body: JSON.stringify({ userIds: ['u1'] }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'c1' }) });
    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'COURSE_BULK_ENROLL_ERROR',
        metadata: expect.objectContaining({ error: 'unknown error' }),
      }),
    );
  });
});
