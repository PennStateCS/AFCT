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

  it('returns only students', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.roster.findMany.mockResolvedValue([
      {
        role: 'STUDENT',
        user: { id: 's1', firstName: 'A', lastName: 'S', email: 's1@example.com', role: 'STUDENT' },
      },
      {
        role: 'TA',
        user: { id: 't1', firstName: 'T', lastName: 'A', email: 't1@example.com', role: 'TA' },
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
  });
});
