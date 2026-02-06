import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    update: vi.fn(),
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
});

describe('PATCH /api/courses/[id]/publish', () => {
  it('returns 400 when isPublished is invalid', async () => {
    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: 'yes' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when cannot unpublish', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    canUnpublishMock.mockResolvedValue({ canUnpublish: false, reason: 'blocked' });

    const req = new Request('http://localhost/api/courses/c1/publish', {
      method: 'PATCH',
      body: JSON.stringify({ isPublished: false }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('updates publish status and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
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
});
