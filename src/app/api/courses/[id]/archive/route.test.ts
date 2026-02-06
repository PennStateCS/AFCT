import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn(), update: vi.fn() },
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
});

describe('PATCH /api/courses/[id]/archive', () => {
  it('returns 400 when isArchived invalid', async () => {
    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: 'yes' }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 404 when course not found on archive', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.course.findUnique.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/archive', {
      method: 'PATCH',
      body: JSON.stringify({ isArchived: true }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'c1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 403 when cannot archive', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
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
});
