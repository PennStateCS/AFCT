import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  roster: {
    findFirst: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const canUnpublishMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/course-status-checks', () => ({ canUnpublishCourse: canUnpublishMock }));

import { PATCH } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  // Default: the course is not archived, so the wrapper's archive freeze is a no-op.
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
});

describe('PATCH /api/courses/[id]/publish', () => {
  it('returns 400 when isPublished is invalid', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: 'yes' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when cannot unpublish', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    canUnpublishMock.mockResolvedValue({ canUnpublish: false, reason: 'blocked' });

    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: false }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('updates publish status and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    canUnpublishMock.mockResolvedValue({ canUnpublish: true });
    prismaMock.course.update.mockResolvedValue({
      id: 'c1',
      name: 'Course',
      code: 'C1',
      isPublished: true,
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.course.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('lets a TA publish (TA = faculty)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA' });
    canUnpublishMock.mockResolvedValue({ canUnpublish: true });
    prismaMock.course.update.mockResolvedValue({
      id: 'c1',
      name: 'Course',
      code: 'C1',
      isPublished: true,
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
  });

  it('forbids a student from publishing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT' });

    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it('returns 409 and does not update when the course is archived', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.course.findUnique.mockResolvedValue({ isArchived: true });

    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(409);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
  });

  it('returns 500 and logs when the update throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.course.update.mockRejectedValue(new Error('db down'));

    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'COURSE_PUBLISH_ERROR' }),
    );
    consoleSpy.mockRestore();
  });
});
