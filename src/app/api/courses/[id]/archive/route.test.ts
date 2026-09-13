import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn(), update: vi.fn() },
  roster: { findFirst: vi.fn() },
  // The archive check runs inside the transaction now, holding the rows a submission would
  // attach to, so that "nobody has handed anything in" is still true when the update lands.
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const canArchiveMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
const lockCourseWorkMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/course-status-checks', () => ({
  canArchiveCourse: canArchiveMock,
  lockCourseWork: lockCourseWorkMock,
}));

import { PATCH } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: caller is not enrolled (denied) unless a test says otherwise.
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(prismaMock),
  );
  lockCourseWorkMock.mockResolvedValue(undefined);
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

  /**
   * Archiving an in-session course is refused once anybody has handed work in, because it
   * freezes the course for everyone. Asking and then updating separately meant a submission
   * arriving in between was frozen out by a decision taken before it existed.
   */
  it('checks and updates inside one transaction, holding the work rows', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.course.findUnique.mockResolvedValue({
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-06-01'),
    });
    canArchiveMock.mockResolvedValue({ canArchive: true });
    prismaMock.course.update.mockResolvedValue({ id: 'c1', isArchived: true });

    await PATCH(
      new Request('http://localhost/api/courses/c1/archive', {
        method: 'PATCH',
        body: JSON.stringify({ isArchived: true }),
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(lockCourseWorkMock).toHaveBeenCalledWith(prismaMock, 'c1');
    // Through the transaction client, or the answer could go stale before the update.
    expect(canArchiveMock.mock.calls[0]?.[0]).toBe(prismaMock);
  });

  it('does not take the lock when restoring, which only gives access back', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.course.update.mockResolvedValue({ id: 'c1', isArchived: false });

    await PATCH(
      new Request('http://localhost/api/courses/c1/archive', {
        method: 'PATCH',
        body: JSON.stringify({ isArchived: false }),
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );

    expect(lockCourseWorkMock).not.toHaveBeenCalled();
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
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'COURSE_ARCHIVE_REJECTED', severity: 'WARNING' }),
    );
  });

  it('archives course and logs activity for an admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
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

  it('forbids a non-admin (faculty) from archiving — admin-only', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' }); // staff, passes the wrapper
    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'COURSE_ARCHIVE_DENIED', severity: 'SECURITY' }),
    );
  });

  it('forbids a non-admin (faculty) from un-archiving — admin-only', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' }); // staff, passes the wrapper
    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: false }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.course.update).not.toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'COURSE_ARCHIVE_DENIED', severity: 'SECURITY' }),
    );
  });

  it('lets an admin un-archive', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.course.update.mockResolvedValue({
      id: 'c1',
      name: 'Course',
      code: 'C1',
      isArchived: false,
      updatedAt: new Date(),
    });

    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: false }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.course.update).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'COURSE_UNARCHIVED' }),
    );
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
