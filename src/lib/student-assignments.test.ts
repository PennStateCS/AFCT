import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findMany: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
  submission: { groupBy: vi.fn(), findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getStudentCourseAssignments } from './student-assignments';

const studentOverride = (over: Record<string, unknown>) => ({
  targetType: 'STUDENT',
  userId: 'stu-1',
  groupId: null,
  unlockAt: null,
  dueDate: null,
  lateCutoff: null,
  allowLateSubmissions: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.assignmentProblem.findMany.mockResolvedValue([
    {
      assignmentId: 'a1',
      maxPoints: 10,
      maxSubmissions: 1,
      problem: { id: 'p1', title: 'P1', type: 'FA', autograderEnabled: true },
    },
  ]);
  prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
  prismaMock.submission.groupBy.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
});

describe('getStudentCourseAssignments', () => {
  it('applies the student due-date override', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A1',
        description: 'desc',
        unlockAt: null,
        dueDate: new Date('2026-01-10T23:59:00.000Z'),
        allowLateSubmissions: false,
        lateCutoff: null,
        overrides: [studentOverride({ dueDate: new Date('2026-01-20T23:59:00.000Z') })],
      },
    ]);

    const result = await getStudentCourseAssignments('stu-1', 'c1');

    expect(result[0].dueDate).toEqual(new Date('2026-01-20T23:59:00.000Z'));
    expect(result[0].locked).toBe(false);
    expect(result[0].problems).toHaveLength(1);
  });

  it('locks description and problems before unlock', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A1',
        description: 'secret',
        unlockAt: new Date('2999-01-01T00:00:00.000Z'), // far future
        dueDate: new Date('2999-01-08T00:00:00.000Z'),
        allowLateSubmissions: false,
        lateCutoff: null,
        overrides: [],
      },
    ]);

    const result = await getStudentCourseAssignments('stu-1', 'c1');

    expect(result[0].locked).toBe(true);
    expect(result[0].description).toBeNull();
    expect(result[0].problems).toEqual([]);
  });

  it('re-sorts by the effective due date (an extension moves the assignment later)', async () => {
    prismaMock.assignment.findMany.mockResolvedValue([
      {
        id: 'a1',
        title: 'A1 base earlier',
        description: null,
        unlockAt: null,
        dueDate: new Date('2026-01-05T23:59:00.000Z'),
        allowLateSubmissions: false,
        lateCutoff: null,
        // This student is extended past a2's due date.
        overrides: [studentOverride({ dueDate: new Date('2026-02-01T23:59:00.000Z') })],
      },
      {
        id: 'a2',
        title: 'A2 base later',
        description: null,
        unlockAt: null,
        dueDate: new Date('2026-01-10T23:59:00.000Z'),
        allowLateSubmissions: false,
        lateCutoff: null,
        overrides: [],
      },
    ]);
    prismaMock.assignmentProblem.findMany.mockResolvedValue([]);

    const result = await getStudentCourseAssignments('stu-1', 'c1');

    // a2 (Jan 10) now comes before a1 (extended to Feb 1).
    expect(result.map((a) => a.id)).toEqual(['a2', 'a1']);
  });
});
