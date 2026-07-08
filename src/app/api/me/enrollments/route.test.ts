import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/me/enrollments', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns enrollments when authenticated', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    prismaMock.roster.findMany.mockResolvedValue([
      { course: { id: 'c1', name: 'Course', code: 'C1', isPublished: true } },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ userId: 'u1', isAdmin: false });
    expect(body.enrollments).toHaveLength(1);
  });

  it('returns 500 when the lookup fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    prismaMock.roster.findMany.mockRejectedValue(new Error('db down'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
