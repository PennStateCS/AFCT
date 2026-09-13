import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    update: vi.fn(),
    findUnique: vi.fn(),
  },
  roster: {
    findFirst: vi.fn(),
  },
  // The unpublish check runs inside the transaction now, holding the rows a submission would
  // attach to, so that "nobody has handed anything in" is still true when the update lands.
  $queryRaw: vi.fn(),
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const canUnpublishMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
const lockCourseWorkMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/course-status-checks', () => ({
  canUnpublishCourse: canUnpublishMock,
  // Takes the rows a submission would attach to, so the check's answer holds until the update.
  lockCourseWork: lockCourseWorkMock,
}));

import { PATCH } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  // Default: the course is not archived, so the wrapper's archive freeze is a no-op.
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  prismaMock.$queryRaw.mockResolvedValue([]);
  lockCourseWorkMock.mockResolvedValue(undefined);
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn(prismaMock),
  );
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

  /**
   * Unpublishing takes away access to work students have already handed in, which is why it is
   * refused once any exists. Asking and then updating as separate statements meant a submission
   * arriving in between was disallowed by a decision made before it existed.
   */
  it('checks and updates inside one transaction, holding the work rows', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    canUnpublishMock.mockResolvedValue({ canUnpublish: true });
    prismaMock.course.update.mockResolvedValue({ id: 'c1', isPublished: false });

    await PATCH(
      new Request('http://localhost/api/courses/c1/publish', {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: false }),
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(lockCourseWorkMock).toHaveBeenCalledWith(prismaMock, 'c1');
    // The check reads through the transaction client, not the bare one: outside it the answer
    // could go stale before the update.
    expect(canUnpublishMock).toHaveBeenCalledWith(prismaMock, 'c1');
  });

  it('does not take the lock when publishing, which only ever grants access', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.course.update.mockResolvedValue({ id: 'c1', isPublished: true });

    await PATCH(
      new Request('http://localhost/api/courses/c1/publish', {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: true }),
      }),
      { params: Promise.resolve({ id: 'c1' }) },
    );

    expect(lockCourseWorkMock).not.toHaveBeenCalled();
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
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'COURSE_UNPUBLISH_REJECTED', severity: 'WARNING' }),
    );
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
