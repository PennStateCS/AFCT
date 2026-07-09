import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn(), update: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const canArchiveMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/course-status-checks', () => ({ canArchiveCourse: canArchiveMock }));

import { PATCH } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: caller is not enrolled (denied) unless a test says otherwise.
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('PATCH /api/courses/[id]/archive', () => {
  it('returns 400 when isArchived invalid', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: 'yes' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 404 when course not found on archive', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 403 when cannot archive', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findUnique.mockResolvedValue({ startDate: new Date(), endDate: new Date() });
    canArchiveMock.mockResolvedValue({ canArchive: false, reason: 'blocked' });

    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('archives course and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    // Caller is FACULTY in this course (archive is faculty-tier).
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.course.findUnique.mockResolvedValue({ startDate: new Date(), endDate: new Date() });
    canArchiveMock.mockResolvedValue({ canArchive: true });
    prismaMock.course.update.mockResolvedValue({
      id: 'c1',
      name: 'Course',
      code: 'C1',
      isArchived: true,
      updatedAt: new Date(),
    });

    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.course.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 500 and logs when the update throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.course.findUnique.mockResolvedValue({ startDate: new Date(), endDate: new Date() });
    canArchiveMock.mockResolvedValue({ canArchive: true });
    prismaMock.course.update.mockRejectedValue(new Error('db down'));

    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(500);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'COURSE_ARCHIVE_ERROR' }),
    );
    consoleSpy.mockRestore();
  });
});
