import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
  assignmentOverride: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  groupMembership: { findMany: vi.fn() },
  studentGroup: { findMany: vi.fn() },
  submission: { groupBy: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getAssignmentStatistics } from './assignment-statistics-service';

const DUE = new Date('2026-08-10T23:59:00.000Z');
const NOW = new Date('2026-08-20T00:00:00.000Z'); // past the base due
const BEFORE = new Date('2026-08-05T00:00:00.000Z');

function baseAssignment(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    title: 'HW 1',
    dueDate: DUE,
    unlockAt: null,
    allowLateSubmissions: false,
    lateCutoff: null,
    assignedToEveryone: true,
    groupSetId: null,
    course: { timezone: 'America/New_York' },
    assignees: [],
    problems: [
      { problemId: 'p1', maxPoints: 10, problem: { title: 'Problem 1' } },
      { problemId: 'p2', maxPoints: 10, problem: { title: 'Problem 2' } },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.assignmentOverride.findMany.mockResolvedValue([]);
  prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
  prismaMock.roster.findMany.mockResolvedValue([]);
  prismaMock.groupMembership.findMany.mockResolvedValue([]);
  prismaMock.studentGroup.findMany.mockResolvedValue([]);
  prismaMock.submission.groupBy.mockResolvedValue([]);
});

describe('getAssignmentStatistics - individual assignment', () => {
  it('measures in students, applies a student exception, and classifies status', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(baseAssignment());
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1' }, { userId: 's2' }]);
    // s1 fully graded 100%, s2 ungraded
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      { studentId: 's1', problemId: 'p1', grade: 10 },
      { studentId: 's1', problemId: 'p2', grade: 10 },
    ]);
    // s1 completed both problems on time; a student due-date exception for s2
    prismaMock.assignmentOverride.findMany.mockResolvedValue([
      {
        targetType: 'STUDENT',
        userId: 's2',
        groupId: null,
        unlockAt: null,
        dueDate: new Date('2026-09-30T23:59:00.000Z'),
        lateCutoff: null,
        allowLateSubmissions: null,
      },
    ]);
    prismaMock.submission.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('problemId')) {
        return Promise.resolve([
          { studentId: 's1', problemId: 'p1', _max: { submittedAt: BEFORE } },
          { studentId: 's1', problemId: 'p2', _max: { submittedAt: BEFORE } },
        ]);
      }
      return Promise.resolve([{ studentId: 's1' }]);
    });

    const stats = (await getAssignmentStatistics('c1', 'a1', NOW))!;

    expect(stats.unit).toBe('student');
    expect(stats.participantCount).toBe(2);
    expect(stats.exceptionCount).toBe(1); // s2 has the future extension
    expect(stats.timezone).toBe('America/New_York');
    expect(stats.baseDueDate).toBe(DUE.toISOString());

    // s1 fully graded 100% -> histogram last bin, s2 excluded (ungraded)
    expect(stats.histogram.includedCount).toBe(1);
    expect(stats.histogram.excludedCount).toBe(1);
    expect(stats.histogram.bins[9]!.count).toBe(1);

    const byKey = Object.fromEntries(stats.status.map((s) => [s.key, s.count]));
    expect(byKey['on-time']).toBe(1); // s1
    // s2: no submission, but its effective due (Sep 30) is in the future -> not started
    expect(byKey['not-started']).toBe(1);
    expect(byKey['missing']).toBe(0);
  });

  it('only counts students who are actually assigned', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(
      baseAssignment({ assignedToEveryone: false, assignees: [{ userId: 's1', groupId: null }] }),
    );
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1' }, { userId: 's2' }]);

    const stats = (await getAssignmentStatistics('c1', 'a1', NOW))!;
    expect(stats.participantCount).toBe(1); // only s1 is assigned
  });
});

describe('getAssignmentStatistics - group assignment', () => {
  it('measures in groups, aggregates member grades, and applies a group exception', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(baseAssignment({ groupSetId: 'gs1' }));
    prismaMock.studentGroup.findMany.mockResolvedValue([
      { id: 'g1', memberships: [{ userId: 'u1' }, { userId: 'u2' }] },
      { id: 'g2', memberships: [{ userId: 'u3' }] },
      { id: 'gEmpty', memberships: [] }, // memberless: excluded
    ]);
    // Autograde fans the grade out to every member; g1 fully graded 100%.
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      { studentId: 'u1', problemId: 'p1', grade: 10 },
      { studentId: 'u1', problemId: 'p2', grade: 10 },
      { studentId: 'u2', problemId: 'p1', grade: 10 },
      { studentId: 'u2', problemId: 'p2', grade: 10 },
    ]);
    // A group due-date exception for g2 (future) keeps it out of "missing".
    prismaMock.assignmentOverride.findMany.mockResolvedValue([
      {
        targetType: 'GROUP',
        userId: null,
        groupId: 'g2',
        unlockAt: null,
        dueDate: new Date('2026-09-30T23:59:00.000Z'),
        lateCutoff: null,
        allowLateSubmissions: null,
      },
    ]);
    prismaMock.submission.groupBy.mockImplementation((args: { by: string[] }) => {
      if (args.by.includes('problemId')) {
        return Promise.resolve([
          { studentGroupId: 'g1', problemId: 'p1', _max: { submittedAt: BEFORE } },
          { studentGroupId: 'g1', problemId: 'p2', _max: { submittedAt: BEFORE } },
        ]);
      }
      return Promise.resolve([{ studentGroupId: 'g1' }]);
    });

    const stats = (await getAssignmentStatistics('c1', 'a1', NOW))!;

    expect(stats.unit).toBe('group');
    expect(stats.participantCount).toBe(2); // g1 + g2, gEmpty excluded
    expect(stats.exceptionCount).toBe(1); // g2

    // g1 graded 100% -> included; g2 ungraded -> excluded
    expect(stats.histogram.includedCount).toBe(1);
    expect(stats.histogram.bins[9]!.count).toBe(1);

    const byKey = Object.fromEntries(stats.status.map((s) => [s.key, s.count]));
    expect(byKey['on-time']).toBe(1); // g1 finished before due
    expect(byKey['not-started']).toBe(1); // g2 on a future deadline
  });
});

it('returns null when the assignment is not in the course', async () => {
  prismaMock.assignment.findFirst.mockResolvedValue(null);
  expect(await getAssignmentStatistics('c1', 'missing', NOW)).toBeNull();
});
