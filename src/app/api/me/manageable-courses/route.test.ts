import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ course: { findMany: vi.fn() } }));
const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

const call = (url = 'http://localhost/api/me/manageable-courses') => GET(new Request(url));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.findMany.mockResolvedValue([]);
});

describe('GET /api/me/manageable-courses', () => {
  it('returns 401 when not signed in', async () => {
    authMock.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });

  it('scopes a non-admin to courses they staff', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false, inactive: false } });
    await call();
    const where = prismaMock.course.findMany.mock.calls[0][0].where;
    expect(where.deletedAt).toBeNull();
    expect(where.roster).toEqual({
      some: { userId: 'u1', role: { in: ['FACULTY', 'TA'] } },
    });
  });

  it('lets an admin see every course (no roster filter)', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true, inactive: false } });
    await call();
    const where = prismaMock.course.findMany.mock.calls[0][0].where;
    expect(where.roster).toBeUndefined();
    expect(where.deletedAt).toBeNull();
  });

  it('excludes the destination course when excludeCourseId is given', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true, inactive: false } });
    await call('http://localhost/api/me/manageable-courses?excludeCourseId=dest');
    const where = prismaMock.course.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ not: 'dest' });
  });
});
