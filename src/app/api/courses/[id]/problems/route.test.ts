import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  problem: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: vi.fn() }));
vi.mock('@/lib/api/activity', () => ({ logError: vi.fn() }));

import { GET } from './route';

const call = () =>
  GET(new Request('http://localhost/api/courses/c1/problems'), {
    params: Promise.resolve({ id: 'c1' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false, deletedAt: null });
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('GET /api/courses/[id]/problems', () => {
  it('returns the course problem bank for staff', async () => {
    prismaMock.problem.findMany.mockResolvedValue([
      { id: 'p1', title: 'FA one', description: null, type: 'FA' },
    ]);
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'p1', title: 'FA one', description: null, type: 'FA' }]);
    expect(prismaMock.problem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: 'c1' } }),
    );
  });

  it('rejects a non-staff caller', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', isAdmin: false } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { deletedAt: null } });
    const res = await call();
    expect(res.status).toBe(403);
    expect(prismaMock.problem.findMany).not.toHaveBeenCalled();
  });
});
