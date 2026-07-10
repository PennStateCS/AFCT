import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: {
    findMany: vi.fn(),
  },
}));
const authMock = vi.hoisted(() => vi.fn());
const getCoursesListForUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/courses-list', () => ({
  getCoursesListForUser: getCoursesListForUserMock,
}));

import { GET } from './route';

const req = (url = 'http://localhost/api/me/courses') => new Request(url);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/me/courses', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(getCoursesListForUserMock).not.toHaveBeenCalled();
  });

  it('returns 401 when user id is missing', async () => {
    authMock.mockResolvedValue({ user: {} });

    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(getCoursesListForUserMock).not.toHaveBeenCalled();
  });

  it('requests STUDENT-scoped courses for a non-admin user', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    getCoursesListForUserMock.mockResolvedValue([{ id: 'c1', name: 'Course 1' }]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(getCoursesListForUserMock).toHaveBeenCalledWith('u1', 'STUDENT');
    expect(await res.json()).toEqual([{ id: 'c1', name: 'Course 1' }]);
  });

  it('requests ADMIN-scoped courses for an admin user', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    getCoursesListForUserMock.mockResolvedValue([{ id: 'c1', name: 'Course 1' }]);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(getCoursesListForUserMock).toHaveBeenCalledWith('u1', 'ADMIN');
    expect(await res.json()).toEqual([{ id: 'c1', name: 'Course 1' }]);
  });

  it('returns 500 when query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    getCoursesListForUserMock.mockRejectedValue(new Error('boom'));

    const res = await GET(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Server error' });
    consoleSpy.mockRestore();
  });
});

describe('GET /api/me/courses?view=nav', () => {
  const navUrl = 'http://localhost/api/me/courses?view=nav';

  it('returns 401 when session is missing', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(req(navUrl));

    expect(res.status).toBe(401);
    expect(prismaMock.course.findMany).not.toHaveBeenCalled();
    expect(getCoursesListForUserMock).not.toHaveBeenCalled();
  });

  it('applies the published-or-staff filter for non-admin users', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', isAdmin: false } });
    prismaMock.course.findMany.mockResolvedValue([
      {
        id: 'c1',
        name: 'Course 1',
        code: 'CS101',
        isPublished: true,
        isArchived: false,
      },
    ]);

    const res = await GET(req(navUrl));

    expect(res.status).toBe(200);
    // The compact nav shape uses a direct query, not getCoursesListForUser.
    expect(getCoursesListForUserMock).not.toHaveBeenCalled();
    expect(prismaMock.course.findMany).toHaveBeenCalledWith({
      where: {
        roster: { some: { userId: 'student-1' } },
        deletedAt: null,
        OR: [
          { isPublished: true },
          { roster: { some: { userId: 'student-1', role: { in: ['FACULTY', 'TA'] } } } },
        ],
      },
      select: {
        id: true,
        name: true,
        code: true,
        isPublished: true,
        isArchived: true,
        startDate: true,
        endDate: true,
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

  it('does not force published filter for admins', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
    prismaMock.course.findMany.mockResolvedValue([]);

    const res = await GET(req(navUrl));

    expect(res.status).toBe(200);
    expect(prismaMock.course.findMany).toHaveBeenCalledWith({
      where: {
        roster: { some: { userId: 'admin-1' } },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        isPublished: true,
        isArchived: true,
        startDate: true,
        endDate: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns 500 when database query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    prismaMock.course.findMany.mockRejectedValue(new Error('boom'));

    const res = await GET(req(navUrl));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Server error' });
    consoleSpy.mockRestore();
  });
});
