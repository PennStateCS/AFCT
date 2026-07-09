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

  it('returns courses for user', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findMany.mockResolvedValue([{ id: 'c1', name: 'Course' }]);

    const res = await GET(new Request('http://localhost/api/courses/userCourses/a@example.com'), {
      params: Promise.resolve({ email: 'a@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([{ id: 'c1', name: 'Course' }]);

    // Ensure we filter out courses that haven't started yet by querying startDate <= now
    expect(prismaMock.course.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roster: { some: { userId: 'u1' } },
          isArchived: false,
          startDate: expect.objectContaining({ lte: expect.any(Date) }),
        }),
        select: { id: true, name: true },
      }),
    );
  });

  it('returns 500 when the course query fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    prismaMock.course.findMany.mockRejectedValueOnce(new Error('db down'));

    const res = await GET(new Request('http://localhost/api/courses/userCourses/a@example.com'), {
      params: Promise.resolve({ email: 'a@example.com' }),
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ message: 'Server error' });
  });
});
