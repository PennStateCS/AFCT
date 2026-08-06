import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findMany: vi.fn(), count: vi.fn() },
  user: { findMany: vi.fn() },
  assignment: { findMany: vi.fn() },
  groupMembership: { findMany: vi.fn() },
  assignmentProblemGrade: { groupBy: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getCourseGradeMatrix, getCourseGradeColumns, getCourseGradePage } from './course-grades';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1' }, { userId: 's2' }]);
  prismaMock.user.findMany.mockResolvedValue([
    { id: 's1', firstName: 'Ada', lastName: 'L', email: 'a@x.io', avatar: null, cropX: null, cropY: null, zoom: null },
    { id: 's2', firstName: 'Alan', lastName: 'T', email: 't@x.io', avatar: null, cropX: null, cropY: null, zoom: null },
  ]);
  prismaMock.groupMembership.findMany.mockResolvedValue([]);
  prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([]);
});

describe('getCourseGradeMatrix — assigned map', () => {
  it('marks students assigned via everyone, individual override, and group override', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      // Assigned to everyone: both students assigned.
      { id: 'a1', title: 'A1', dueDate: null, assignedToEveryone: true, problems: [], assignees: [] },
      // Not everyone, individual assignee for s1 only.
      {
        id: 'a2',
        title: 'A2',
        dueDate: null,
        assignedToEveryone: false,
        problems: [],
        assignees: [{ userId: 's1', groupId: null }],
      },
      // Not everyone, group assignee on g1 (s2 is a member).
      {
        id: 'a3',
        title: 'A3',
        dueDate: null,
        assignedToEveryone: false,
        problems: [],
        assignees: [{ userId: null, groupId: 'g1' }],
      },
    ]);
    prismaMock.groupMembership.findMany.mockResolvedValue([{ userId: 's2', groupId: 'g1' }]);

    const matrix = await getCourseGradeMatrix('c1');

    // Everyone -> both assigned.
    expect(matrix.assigned.s1.a1).toBe(true);
    expect(matrix.assigned.s2.a1).toBe(true);
    // Individual override for s1 only.
    expect(matrix.assigned.s1.a2).toBe(true);
    expect(matrix.assigned.s2.a2).toBe(false);
    // Group override: only the group member (s2) is assigned.
    expect(matrix.assigned.s1.a3).toBe(false);
    expect(matrix.assigned.s2.a3).toBe(true);

    // Membership lookup is batched into a single query for the whole roster.
    expect(prismaMock.groupMembership.findMany).toHaveBeenCalledTimes(1);
  });
});

/*
 * The whole-course matrix stays unpaginated because the LMS export builds on it, so these
 * pin the value-side behaviour that the export depends on. They used to live in the grades
 * route test, which no longer returns a matrix.
 */
describe('getCourseGradeMatrix — values', () => {
  const oneAssignment = () =>
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A1',
        dueDate: null,
        assignedToEveryone: true,
        problems: [{ maxPoints: 10 }],
        assignees: [],
      },
    ]);

  it('sums problem grades into one assignment total per student', async () => {
    oneAssignment();
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
      { studentId: 's1', assignmentId: 'a1', _sum: { grade: 95 } },
    ]);

    const matrix = await getCourseGradeMatrix('c1');

    expect(matrix.grades).toEqual({ s1: { a1: 95 }, s2: { a1: null } });
  });

  it('fills nulls when nothing is graded', async () => {
    oneAssignment();

    const matrix = await getCourseGradeMatrix('c1');

    expect(matrix.grades).toEqual({ s1: { a1: null }, s2: { a1: null } });
  });

  it('coerces a null sum to 0 and ignores rows for unknown students', async () => {
    oneAssignment();
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
      { studentId: 's1', assignmentId: 'a1', _sum: { grade: null } },
      { studentId: 'ghost', assignmentId: 'a1', _sum: { grade: 5 } },
    ]);

    const matrix = await getCourseGradeMatrix('c1');

    expect(matrix.grades.s1.a1).toBe(0);
    expect(matrix.grades.ghost).toBeUndefined();
  });

  it('treats a null problem maxPoints as 0 when summing assignment points', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A1',
        dueDate: null,
        assignedToEveryone: true,
        problems: [{ maxPoints: null }, { maxPoints: 5 }],
        assignees: [],
      },
    ]);

    const matrix = await getCourseGradeMatrix('c1');

    expect(matrix.assignments[0].maxPoints).toBe(5);
  });

  it('skips the grade aggregate entirely when there are no assignments', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([]);

    const matrix = await getCourseGradeMatrix('c1');

    expect(matrix.assignments).toEqual([]);
    expect(prismaMock.assignmentProblemGrade.groupBy).not.toHaveBeenCalled();
  });

  it('skips the user lookup when the roster is empty', async () => {
    prismaMock.roster.findMany.mockResolvedValue([]);
    prismaMock.assignment.findMany.mockResolvedValue([]);

    const matrix = await getCourseGradeMatrix('c1');

    expect(matrix.students).toEqual([]);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });
});

describe('getCourseGradeColumns', () => {
  it('returns the columns and the course student total, with no student rows', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A1',
        dueDate: null,
        assignedToEveryone: true,
        problems: [{ maxPoints: 10 }],
        assignees: [],
      },
    ]);
    prismaMock.roster.count.mockResolvedValue(1200);

    const columns = await getCourseGradeColumns('c1');

    expect(columns.assignments).toEqual([{ id: 'a1', title: 'A1', dueDate: null, maxPoints: 10 }]);
    expect(columns.totalStudents).toBe(1200);
  });
});

describe('getCourseGradePage', () => {
  const twoAssignments = () =>
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A1',
        dueDate: null,
        assignedToEveryone: true,
        problems: [{ maxPoints: 10 }],
        assignees: [],
      },
      {
        id: 'a2',
        title: 'A2',
        dueDate: null,
        assignedToEveryone: true,
        problems: [{ maxPoints: 10 }],
        assignees: [],
      },
    ]);

  beforeEach(() => {
    prismaMock.roster.count.mockResolvedValue(2);
    prismaMock.roster.findMany.mockResolvedValue([
      { userId: 's1', status: 'ENROLLED' },
      { userId: 's2', status: 'ENROLLED' },
    ]);
    twoAssignments();
  });

  it('returns rows carrying their own assigned flags and grades', async () => {
    prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
      { studentId: 's1', assignmentId: 'a1', _sum: { grade: 8 } },
    ]);

    const { rows, total } = await getCourseGradePage({ courseId: 'c1', skip: 0, take: 10 });

    expect(total).toBe(2);
    expect(rows[0]).toMatchObject({ id: 's1', enrollmentStatus: 'ENROLLED' });
    expect(rows[0].grades).toEqual({ a1: 8, a2: null });
    expect(rows[0].assigned).toEqual({ a1: true, a2: true });
  });

  it('keeps dropped students, labelled, so their grades stay editable', async () => {
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 's2', status: 'DROPPED' }]);
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: 's2',
        firstName: 'Alan',
        lastName: 'T',
        email: 't@x.io',
        avatar: null,
        cropX: null,
        cropY: null,
        zoom: null,
      },
    ]);

    const { rows } = await getCourseGradePage({ courseId: 'c1', skip: 0, take: 10 });

    expect(rows[0].enrollmentStatus).toBe('DROPPED');
    // The roster query never filters on status.
    expect(prismaMock.roster.findMany.mock.calls[0][0].where).not.toHaveProperty('status');
  });

  it('searches the student, not the grades', async () => {
    await getCourseGradePage({ courseId: 'c1', skip: 0, take: 10, q: 'ada' });

    expect(prismaMock.roster.findMany.mock.calls[0][0].where.user).toEqual({
      OR: [
        { firstName: { contains: 'ada', mode: 'insensitive' } },
        { lastName: { contains: 'ada', mode: 'insensitive' } },
        { email: { contains: 'ada', mode: 'insensitive' } },
      ],
    });
  });

  describe('sorting', () => {
    it('lets the database order and slice a student-field sort', async () => {
      await getCourseGradePage({ courseId: 'c1', skip: 20, take: 10, sortBy: 'lastName' });

      const call = prismaMock.roster.findMany.mock.calls[0][0];
      expect(call.orderBy[0]).toEqual({ user: { lastName: 'asc' } });
      // Only the page is touched for the cheap tier.
      expect(call.skip).toBe(20);
      expect(call.take).toBe(10);
    });

    it('orders by one assignment column without loading the whole matrix', async () => {
      prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
        { studentId: 's2', assignmentId: 'a1', _sum: { grade: 9 } },
        { studentId: 's1', assignmentId: 'a1', _sum: { grade: 3 } },
      ]);

      const { rows } = await getCourseGradePage({
        courseId: 'c1',
        skip: 0,
        take: 10,
        sortBy: 'a1',
        sortDir: 'desc',
      });

      expect(rows.map((r) => r.id)).toEqual(['s2', 's1']);
      // Scoped to the one column being sorted, not every assignment.
      expect(prismaMock.assignmentProblemGrade.groupBy.mock.calls[0][0].where.assignmentId.in).toEqual(
        ['a1'],
      );
      // The candidate list is ordered by the server, so it must not also skip/take.
      expect(prismaMock.roster.findMany.mock.calls[0][0].skip).toBeUndefined();
    });

    it('orders by Average, counting only assignments the student is assigned', async () => {
      // s1 is assigned both (10 + 10 available) and earns 8 -> 40%.
      // s2 is assigned only a1 (10 available) and earns 8 -> 80%, so s2 leads on desc.
      prismaMock.assignment.findMany.mockResolvedValue([
        {
          id: 'a1',
          title: 'A1',
          dueDate: null,
          assignedToEveryone: true,
          problems: [{ maxPoints: 10 }],
          assignees: [],
        },
        {
          id: 'a2',
          title: 'A2',
          dueDate: null,
          assignedToEveryone: false,
          problems: [{ maxPoints: 10 }],
          assignees: [{ userId: 's1', groupId: null }],
        },
      ]);
      prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
        { studentId: 's1', assignmentId: 'a1', _sum: { grade: 8 } },
        { studentId: 's2', assignmentId: 'a1', _sum: { grade: 8 } },
      ]);

      const { rows } = await getCourseGradePage({
        courseId: 'c1',
        skip: 0,
        take: 10,
        sortBy: 'totalGrade',
        sortDir: 'desc',
      });

      expect(rows.map((r) => r.id)).toEqual(['s2', 's1']);
    });

    it('sorts students with no graded work last, whichever way the column points', async () => {
      prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
        { studentId: 's2', assignmentId: 'a1', _sum: { grade: 5 } },
      ]);

      const asc = await getCourseGradePage({
        courseId: 'c1',
        skip: 0,
        take: 10,
        sortBy: 'totalGrade',
        sortDir: 'asc',
      });
      const desc = await getCourseGradePage({
        courseId: 'c1',
        skip: 0,
        take: 10,
        sortBy: 'totalGrade',
        sortDir: 'desc',
      });

      // s1 has nothing graded, so it trails in both directions.
      expect(asc.rows[asc.rows.length - 1].id).toBe('s1');
      expect(desc.rows[desc.rows.length - 1].id).toBe('s1');
    });

    it('slices the ordered list to the requested page', async () => {
      prismaMock.assignmentProblemGrade.groupBy.mockResolvedValue([
        { studentId: 's1', assignmentId: 'a1', _sum: { grade: 1 } },
        { studentId: 's2', assignmentId: 'a1', _sum: { grade: 2 } },
      ]);
      prismaMock.user.findMany.mockResolvedValue([
        {
          id: 's2',
          firstName: 'Alan',
          lastName: 'T',
          email: 't@x.io',
          avatar: null,
          cropX: null,
          cropY: null,
          zoom: null,
        },
      ]);

      const { rows } = await getCourseGradePage({
        courseId: 'c1',
        skip: 1,
        take: 1,
        sortBy: 'a1',
        sortDir: 'asc',
      });

      expect(rows.map((r) => r.id)).toEqual(['s2']);
    });
  });

  it('returns nothing without touching users when the page is empty', async () => {
    prismaMock.roster.findMany.mockResolvedValue([]);
    prismaMock.roster.count.mockResolvedValue(0);

    const { rows, total } = await getCourseGradePage({ courseId: 'c1', skip: 0, take: 10 });

    expect(rows).toEqual([]);
    expect(total).toBe(0);
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });
});
