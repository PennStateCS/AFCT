import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
const getCoursesMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({ roster: { findMany: vi.fn() } }));

vi.mock('@/lib/client-auth', () => ({ resolveClientToken: resolveMock }));
vi.mock('@/lib/courses-list', () => ({ getCoursesListForUser: getCoursesMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';

const makeReq = (authHeader?: string) =>
  new Request('http://localhost/api/client/v1/courses', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(() => vi.clearAllMocks());

describe('GET /api/client/v1/courses', () => {
  it('401 without a token', async () => {
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(401);
    expect(getCoursesMock).not.toHaveBeenCalled();
  });

  it('returns the caller-scoped courses with their role', async () => {
    resolveMock.mockResolvedValue({
      tokenId: 't1',
      user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: null, lastName: null },
    });
    getCoursesMock.mockResolvedValue([
      { id: 'c1', name: 'Automata', code: 'CMPEN 331', semester: 'Fall', isPublished: true, isArchived: false },
      // An archived course must be filtered out of the client list.
      { id: 'c2', name: 'Old', code: 'CMPEN 100', semester: 'Spring', isPublished: true, isArchived: true },
    ]);
    prismaMock.roster.findMany.mockResolvedValue([{ courseId: 'c1', role: 'STUDENT' }]);

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(getCoursesMock).toHaveBeenCalledWith('u1', 'STUDENT');
    expect(body.courses).toEqual([
      {
        id: 'c1',
        name: 'Automata',
        code: 'CMPEN 331',
        semester: 'Fall',
        isPublished: true,
        isArchived: false,
        role: 'STUDENT',
      },
    ]);
  });
});
