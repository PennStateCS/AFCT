import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeCtx } from '@/test/route';

const authMock = vi.hoisted(() => vi.fn());
const getUsersPageMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/users-list', () => ({ getUsersPage: getUsersPageMock }));

import { GET } from './route';

const req = (query = '') => new Request(`http://localhost/api/admin/users/list${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  getUsersPageMock.mockResolvedValue({ rows: [], total: 0 });
});

describe('GET /api/admin/users/list', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await GET(req(), routeCtx());
    expect(res.status).toBe(401);
  });

  it('returns a paginated page for an admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    getUsersPageMock.mockResolvedValue({ rows: [{ id: 'u2' }], total: 23 });

    const res = await GET(req('?page=2&pageSize=5'), routeCtx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      rows: [{ id: 'u2' }],
      total: 23,
      page: 2,
      pageSize: 5,
      totalPages: 5,
    });
    // page 2 of 5 → skip 5, take 5.
    expect(getUsersPageMock).toHaveBeenCalledWith(expect.objectContaining({ skip: 5, take: 5 }));
  });

  it('parses search, filters, and sort into the query', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });

    await GET(
      req('?q=ada&field=email&admin=true&status=inactive&lock=locked&temp=false&sortBy=email&sortDir=desc'),
      routeCtx(),
    );

    expect(getUsersPageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'ada',
        field: 'email',
        admin: [true],
        inactive: [true], // status=inactive → inactive true
        // `temp=false` is the old boolean spelling, still understood so a bookmarked filter
        // keeps working; it means the same thing the "Normal" option now selects.
        passwordStatus: ['normal'],
        lock: ['locked'],
        sortBy: 'email',
        sortDir: 'desc',
      }),
    );
  });

  /**
   * Password Status has three values now. The old `temp=true`/`temp=false` links have to keep
   * meaning what they did, or a saved column state silently starts filtering on something else.
   */
  it('reads the three password-status values, and the old boolean spellings', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });

    await GET(req('?temp=none&temp=temporary'), routeCtx());
    expect(getUsersPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ passwordStatus: ['temporary', 'none'] }),
    );

    getUsersPageMock.mockClear();
    await GET(req('?temp=true'), routeCtx());
    expect(getUsersPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ passwordStatus: ['temporary'] }),
    );
  });

  it('returns 500 when the query throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: true } });
    getUsersPageMock.mockRejectedValue(new Error('db error'));

    const res = await GET(req(), routeCtx());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to fetch users' });
  });
});
