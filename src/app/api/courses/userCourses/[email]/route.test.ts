import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/userCourses/[email]', () => {
  it('returns 400 when email missing', async () => {
    const res = await GET(new Request('http://localhost/api/courses/userCourses/'), {
      params: Promise.resolve({ email: '' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/userCourses/a@example.com'), {
      params: Promise.resolve({ email: 'a@example.com' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns courses for a non-admin, hiding unpublished courses from students', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findMany.mockResolvedValue([{ id: 'c1', name: 'Course' }]);

    const res = await GET(new Request('http://localhost/api/courses/userCourses/a@example.com'), {
      params: Promise.resolve({ email: 'a@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'c1', name: 'Course' }]);

    // Visibility mirrors canAccessCourse: published-and-enrolled OR staff-on-course.
    // Also excludes not-yet-started and archived courses.
    expect(prismaMock.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { isPublished: true, roster: { some: { userId: 'u1' } } },
            { roster: { some: { userId: 'u1', role: { in: ['FACULTY', 'TA'] } } } },
          ],
          isArchived: false,
          startDate: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        select: { id: true, name: true },
      }),
    );
  });

  it('an admin sees any course they are rostered on (no published restriction)', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin1', isAdmin: true } });
    prismaMock.course.findMany.mockResolvedValue([]);

    await GET(new Request('http://localhost/api/courses/userCourses/a@example.com'), {
      params: Promise.resolve({ email: 'a@example.com' }),
    });

    const where = prismaMock.course.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ roster: { some: { userId: 'admin1' } } });
    expect(where.OR).toBeUndefined();
  });

  it('returns 500 when the course query fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findMany.mockRejectedValueOnce(new Error('db down'));

    const res = await GET(new Request('http://localhost/api/courses/userCourses/a@example.com'), {
      params: Promise.resolve({ email: 'a@example.com' }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Server error' });
  });
});
