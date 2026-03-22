import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    findMany: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/nav', () => {
  it('returns 401 when session is missing', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when user id or role is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
  });

  it('filters to published courses for students', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.course.findMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'Course 1',
        code: 'CS101',
        isPublished: true,
        isArchived: false,
      },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(prismaMock.course.findMany).toHaveBeenCalledWith({
      where: {
        roster: { some: { userId: 'student-1' } },
        isPublished: true,
      },
      select: {
        id: true,
        name: true,
        code: true,
        isPublished: true,
        isArchived: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const body = await res.json();
    expect(body).toEqual([
      {
        id: 'c1',
        name: 'Course 1',
        code: 'CS101',
        isPublished: true,
        isArchived: false,
      },
    ]);
  });

  it('does not force published filter for non-student roles', async () => {
    authMock.mockResolvedValue({ user: { id: 'fac-1', role: 'FACULTY' } });
    prismaMock.course.findMany.mockResolvedValue([]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(prismaMock.course.findMany).toHaveBeenCalledWith({
      where: {
        roster: { some: { userId: 'fac-1' } },
      },
      select: {
        id: true,
        name: true,
        code: true,
        isPublished: true,
        isArchived: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns 500 when database query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.course.findMany.mockRejectedValue(new Error('boom'));

    const res = await GET();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ message: 'Server error' });
    consoleSpy.mockRestore();
  });
});
