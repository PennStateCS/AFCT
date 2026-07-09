import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const getUsersListMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/users-list', () => ({ getUsersList: getUsersListMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/users/list', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('returns users list for authorized roles', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    getUsersListMock.mockResolvedValue([{ id: 'u2', email: 'u2@example.com' }]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(getUsersListMock).toHaveBeenCalled();
    await expect(res.json()).resolves.toEqual([{ id: 'u2', email: 'u2@example.com' }]);
  });

  it('returns 500 when query throws', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    getUsersListMock.mockRejectedValue(new Error('db error'));

    const res = await GET();

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to fetch users' });
  });
});
