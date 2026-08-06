import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const getUsersPageMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/users-list', () => ({ getUsersPage: getUsersPageMock }));

import { GET } from './route';

const req = (query = '') => new Request(`http://localhost/api/courses/c1/enrollable-users${query}`);
const ctx = { params: Promise.resolve({ id: 'c1' }) };
const staff = () => prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'fac-1', isAdmin: false } });
  // Default: caller not on the roster (denied); authorized tests grant a course role.
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  getUsersPageMock.mockResolvedValue({ rows: [], total: 0 });
});

describe('GET /api/courses/[id]/enrollable-users', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(req(), ctx);

    expect(res.status).toBe(401);
    expect(getUsersPageMock).not.toHaveBeenCalled();
  });

  it('returns 403 for someone who is not course staff', async () => {
    const res = await GET(req(), ctx);

    expect(res.status).toBe(403);
    expect(getUsersPageMock).not.toHaveBeenCalled();
  });

  it('excludes people already on this course roster', async () => {
    staff();

    await GET(req('?q=turing'), ctx);

    // The exclusion is a where clause, which is what makes the dialog correct without
    // holding the whole roster in the browser to subtract.
    expect(getUsersPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ excludeCourseId: 'c1', q: 'turing' }),
    );
  });

  it('offers active accounts only', async () => {
    staff();

    await GET(req(), ctx);

    // The enroll endpoint refuses an inactive account, so offering one could only 409.
    expect(getUsersPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ inactive: [false] }),
    );
  });

  it('returns the page envelope', async () => {
    staff();
    getUsersPageMock.mockResolvedValue({ rows: [{ id: 'u2' }], total: 312 });

    const res = await GET(req('?pageSize=50'), ctx);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rows: [{ id: 'u2' }],
      total: 312,
      page: 1,
      pageSize: 50,
      totalPages: 7,
    });
  });

  it('clamps an oversized pageSize', async () => {
    staff();

    await GET(req('?pageSize=5000'), ctx);

    expect(getUsersPageMock).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('returns 500 when the query fails', async () => {
    staff();
    getUsersPageMock.mockRejectedValue(new Error('db down'));

    const res = await GET(req(), ctx);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to search accounts' });
  });
});
