import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: caller not enrolled (denied); authorized tests grant a course role.
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('GET /api/courses/[id]/students', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/courses/c1/students'), {
      params: Promise.resolve({ id: 'c1' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns only students (STUDENT filtered in the query)', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.roster.findMany.mockResolvedValue([
      {
        role: 'STUDENT',
        user: { id: 's1', firstName: 'A', lastName: 'S', email: 's1@example.com', role: 'STUDENT' },
      },
    ]);

    const res = await GET(new Request('http://localhost/api/courses/c1/students'), {
      params: Promise.resolve({ id: 'c1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      { id: 's1', firstName: 'A', lastName: 'S', email: 's1@example.com', role: 'STUDENT' },
    ]);
    // The role filter must be in the query, not applied in JS after fetching all roles.
    expect(prismaMock.roster.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: 'c1', role: 'STUDENT' } }),
    );
  });
});
