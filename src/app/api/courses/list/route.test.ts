import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const getCoursesListForUserMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/courses-list', () => ({
  getCoursesListForUser: getCoursesListForUserMock,
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/courses/list', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(getCoursesListForUserMock).not.toHaveBeenCalled();
  });

  it('returns 401 when user id or role is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });

    const res = await GET();

    expect(res.status).toBe(401);
    expect(getCoursesListForUserMock).not.toHaveBeenCalled();
  });

  it('returns role-scoped courses for authenticated user', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    getCoursesListForUserMock.mockResolvedValue([{ id: 'c1', name: 'Course 1' }]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(getCoursesListForUserMock).toHaveBeenCalledWith('u1', 'FACULTY');
    expect(await res.json()).toEqual([{ id: 'c1', name: 'Course 1' }]);
  });

  it('returns 500 when query fails', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    getCoursesListForUserMock.mockRejectedValue(new Error('boom'));

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: 'Server error' });
    consoleSpy.mockRestore();
  });
});
