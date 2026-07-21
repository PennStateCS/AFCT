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

// Deterministic ranges relative to "now" (well before/after the current date).
const IN_RANGE = { startDate: new Date('2000-01-01'), endDate: new Date('2999-01-01') };
const PAST = { startDate: new Date('2000-01-01'), endDate: new Date('2001-01-01') };
const FUTURE = { startDate: new Date('2998-01-01'), endDate: new Date('2999-01-01') };

const course = (over: Record<string, unknown>) => ({
  name: 'Automata',
  code: 'CMPEN 331',
  semester: 'Fall',
  timezone: 'America/New_York',
  isPublished: true,
  isArchived: false,
  ...IN_RANGE,
  ...over,
});

const asStudent = () =>
  resolveMock.mockResolvedValue({
    tokenId: 't1',
    user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: null, lastName: null },
  });
const asAdmin = () =>
  resolveMock.mockResolvedValue({
    tokenId: 't1',
    user: { id: 'u1', isAdmin: true, email: 'a@b.c', firstName: null, lastName: null },
  });

const codesOf = async (res: Response) => (await res.json()).courses.map((c: { id: string }) => c.id);

beforeEach(() => vi.clearAllMocks());

describe('GET /api/client/v1/courses', () => {
  it('401 without a token', async () => {
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(401);
    expect(getCoursesMock).not.toHaveBeenCalled();
  });

  it('returns the caller-scoped courses with their role, dropping archived ones', async () => {
    asStudent();
    getCoursesMock.mockResolvedValue([
      course({ id: 'c1' }),
      // An archived course must be filtered out of the client list.
      course({ id: 'c2', code: 'CMPEN 100', isArchived: true }),
    ]);
    prismaMock.roster.findMany.mockResolvedValue([{ courseId: 'c1', role: 'STUDENT' }]);

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(200);
    expect(getCoursesMock).toHaveBeenCalledWith('u1', 'STUDENT');
    const body = await res.json();
    expect(body.courses).toEqual([
      {
        id: 'c1',
        name: 'Automata',
        code: 'CMPEN 331',
        semester: 'Fall',
        timezone: 'America/New_York',
        isPublished: true,
        isArchived: false,
        role: 'STUDENT',
      },
    ]);
  });

  it('hides a student course that is outside its date range', async () => {
    asStudent();
    getCoursesMock.mockResolvedValue([
      course({ id: 'inrange' }),
      course({ id: 'past', ...PAST }),
      course({ id: 'future', ...FUTURE }),
    ]);
    prismaMock.roster.findMany.mockResolvedValue([
      { courseId: 'inrange', role: 'STUDENT' },
      { courseId: 'past', role: 'STUDENT' },
      { courseId: 'future', role: 'STUDENT' },
    ]);

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(await codesOf(res)).toEqual(['inrange']);
  });

  it('shows a faculty/TA course even when outside its date range', async () => {
    asStudent(); // not a global admin
    getCoursesMock.mockResolvedValue([
      course({ id: 'facPast', ...PAST }),
      course({ id: 'taFuture', ...FUTURE }),
      course({ id: 'stuPast', ...PAST }),
    ]);
    prismaMock.roster.findMany.mockResolvedValue([
      { courseId: 'facPast', role: 'FACULTY' },
      { courseId: 'taFuture', role: 'TA' },
      { courseId: 'stuPast', role: 'STUDENT' },
    ]);

    const res = await GET(makeReq('Bearer good'), ctx);
    // Staff courses ignore the date window; the student one out of range is dropped.
    expect((await codesOf(res)).sort()).toEqual(['facPast', 'taFuture']);
  });

  it('admin sees every non-archived course regardless of date range or enrollment', async () => {
    asAdmin();
    getCoursesMock.mockResolvedValue([
      course({ id: 'a', ...PAST }),
      course({ id: 'b', ...FUTURE }),
      course({ id: 'c', isPublished: false }),
    ]);
    prismaMock.roster.findMany.mockResolvedValue([]); // admin not enrolled in any

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(getCoursesMock).toHaveBeenCalledWith('u1', 'ADMIN');
    expect((await codesOf(res)).sort()).toEqual(['a', 'b', 'c']);
  });
});
