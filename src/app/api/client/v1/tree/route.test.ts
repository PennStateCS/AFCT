import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
const getCoursesMock = vi.hoisted(() => vi.fn());
const getAssignmentsMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn() },
  groupMembership: { findMany: vi.fn() },
}));

vi.mock('@/lib/client-auth', () => ({ resolveClientToken: resolveMock }));
vi.mock('@/lib/courses-list', () => ({ getCoursesListForUser: getCoursesMock }));
vi.mock('@/lib/student-assignments', () => ({ getStudentCourseAssignments: getAssignmentsMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { GET } from './route';

const ctx = { params: Promise.resolve({}) };
const makeReq = (auth?: string) =>
  new Request('http://localhost/api/client/v1/tree', {
    headers: auth ? { authorization: auth } : {},
  });

const IN_RANGE = { startDate: new Date('2000-01-01'), endDate: new Date('2999-01-01') };
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

const problem = (over: Record<string, unknown>) => ({
  id: 'p1',
  title: 'DFA',
  description: null,
  type: 'FA',
  maxStates: 5,
  isDeterministic: true,
  autograderEnabled: true,
  maxPoints: 10,
  maxSubmissions: 3,
  grade: null,
  submissionCount: 0,
  status: '',
  ...over,
});
const assignment = (over: Record<string, unknown>) => ({
  id: 'a1',
  title: 'HW1',
  groupSetId: null,
  description: 'desc',
  unlockAt: null,
  dueDate: new Date('2026-01-15T04:59:00Z'),
  allowLateSubmissions: false,
  lateCutoff: null,
  locked: false,
  problems: [],
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

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findMany.mockResolvedValue([]);
  prismaMock.groupMembership.findMany.mockResolvedValue([]);
  getAssignmentsMock.mockResolvedValue([]);
});

describe('GET /api/client/v1/tree', () => {
  it('401 without a token', async () => {
    const res = await GET(makeReq(), ctx);
    expect(res.status).toBe(401);
    expect(getCoursesMock).not.toHaveBeenCalled();
  });

  it('nests assignments + problems per course and derives solved from full marks', async () => {
    asStudent();
    getCoursesMock.mockResolvedValue([course({ id: 'c1' })]);
    prismaMock.roster.findMany.mockResolvedValue([{ courseId: 'c1', role: 'STUDENT' }]);
    getAssignmentsMock.mockResolvedValue([
      assignment({
        id: 'a1',
        problems: [
          problem({ id: 'solved', grade: 10, maxPoints: 10, status: 'COMPLETED' }), // full marks
          problem({ id: 'partial', grade: 4, maxPoints: 10 }), // below full
          problem({ id: 'ungraded', grade: null, maxPoints: 10 }),
          problem({ id: 'zeropt', grade: 0, maxPoints: 0 }), // no points -> never solved
        ],
      }),
    ]);

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Students get the base (non-widened) assignment view.
    expect(getAssignmentsMock).toHaveBeenCalledWith('u1', 'c1', {});
    const problems = body.courses[0].assignments[0].problems as Array<{ id: string; solved: boolean }>;
    expect(Object.fromEntries(problems.map((p) => [p.id, p.solved]))).toEqual({
      solved: true,
      partial: false,
      ungraded: false,
      zeropt: false,
    });
  });

  it('hides a locked assignment from a student but keeps its dates', async () => {
    asStudent();
    getCoursesMock.mockResolvedValue([course({ id: 'c1' })]);
    prismaMock.roster.findMany.mockResolvedValue([{ courseId: 'c1', role: 'STUDENT' }]);
    getAssignmentsMock.mockResolvedValue([
      assignment({ id: 'open', locked: false }),
      assignment({ id: 'locked', locked: true }),
    ]);

    const res = await GET(makeReq('Bearer good'), ctx);
    const ids = (await res.json()).courses[0].assignments.map((a: { id: string }) => a.id);
    expect(ids).toEqual(['open']);
  });

  it('staff see every assignment (widened view, locked NOT filtered)', async () => {
    asStudent(); // not a global admin...
    getCoursesMock.mockResolvedValue([course({ id: 'c1' })]);
    prismaMock.roster.findMany.mockResolvedValue([{ courseId: 'c1', role: 'FACULTY' }]); // ...but faculty here
    getAssignmentsMock.mockResolvedValue([assignment({ id: 'locked', locked: true })]);

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(getAssignmentsMock).toHaveBeenCalledWith('u1', 'c1', {
      includeUnpublished: true,
      includeUnassigned: true,
    });
    const ids = (await res.json()).courses[0].assignments.map((a: { id: string }) => a.id);
    expect(ids).toEqual(['locked']); // staff still see it
  });

  it('resolves the group name for a group assignment', async () => {
    asStudent();
    getCoursesMock.mockResolvedValue([course({ id: 'c1' })]);
    prismaMock.roster.findMany.mockResolvedValue([{ courseId: 'c1', role: 'STUDENT' }]);
    getAssignmentsMock.mockResolvedValue([assignment({ id: 'g', groupSetId: 'gs1' })]);
    prismaMock.groupMembership.findMany.mockResolvedValue([
      { groupSetId: 'gs1', group: { name: 'Team Rocket' } },
    ]);

    const res = await GET(makeReq('Bearer good'), ctx);
    const a = (await res.json()).courses[0].assignments[0];
    expect(a.isGroup).toBe(true);
    expect(a.groupName).toBe('Team Rocket');
  });

  it('admin gets the widened view and every visible course', async () => {
    asAdmin();
    getCoursesMock.mockResolvedValue([course({ id: 'c1' }), course({ id: 'c2', isPublished: false })]);
    prismaMock.roster.findMany.mockResolvedValue([]); // not enrolled anywhere

    const res = await GET(makeReq('Bearer good'), ctx);
    expect(getCoursesMock).toHaveBeenCalledWith('u1', 'ADMIN');
    const ids = (await res.json()).courses.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(['c1', 'c2']);
    expect(getAssignmentsMock).toHaveBeenCalledWith('u1', 'c1', {
      includeUnpublished: true,
      includeUnassigned: true,
    });
  });
});
