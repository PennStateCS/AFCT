import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
  assignmentOverride: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  groupMembership: { findMany: vi.fn() },
  studentGroup: { findMany: vi.fn() },
  submission: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getAssignmentStatistics } from './assignment-statistics-service';

const DUE = new Date('2026-08-10T23:59:00.000Z');

function baseAssignment(over: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    title: 'HW 1',
    dueDate: DUE,
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

const statusFor = (stats: { problems: { id: string; status: { key: string; count: number }[] }[] }, id: string) =>
  Object.fromEntries(stats.problems.find((p) => p.id === id)!.status.map((s) => [s.key, s.count]));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.assignmentOverride.findMany.mockResolvedValue([]);
  prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
  prismaMock.roster.findMany.mockResolvedValue([]);
  prismaMock.groupMembership.findMany.mockResolvedValue([]);
  prismaMock.studentGroup.findMany.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
});

describe('getAssignmentStatistics - individual assignment', () => {
  it('measures in students, reports per-problem queue status, and counts exceptions', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(baseAssignment());
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1' }, { userId: 's2' }]);
    // s1 fully graded 100%, s2 ungraded
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      { studentId: 's1', problemId: 'p1', grade: 10 },
      { studentId: 's1', problemId: 'p2', grade: 10 },
    ]);
    // A student due-date exception for s2.
    prismaMock.assignmentOverride.findMany.mockResolvedValue([
      { targetType: 'STUDENT', userId: 's2', groupId: null },
    ]);
    // s1's submissions: p1 solved (Completed), p2 still queued (Pending). s2 never submitted.
    prismaMock.submission.findMany.mockResolvedValue([
      {
        studentId: 's1',
        studentGroupId: null,
        problemId: 'p1',
        submittedAt: new Date('2026-08-01T10:00:00Z'),
        correct: true,
        status: 'COMPLETED',
      },
      {
        studentId: 's1',
        studentGroupId: null,
        problemId: 'p2',
        submittedAt: new Date('2026-08-01T11:00:00Z'),
        correct: false,
        status: 'PENDING',
      },
    ]);

    const stats = (await getAssignmentStatistics('c1', 'a1'))!;

    expect(stats.unit).toBe('student');
    expect(stats.participantCount).toBe(2);
    expect(stats.exceptionCount).toBe(1); // s2
    expect(stats.timezone).toBe('America/New_York');
    expect(stats.baseDueDate).toBe(DUE.toISOString());

    // s1 fully graded 100% -> histogram last bin, s2 excluded (ungraded)
    expect(stats.histogram.includedCount).toBe(1);
    expect(stats.histogram.excludedCount).toBe(1);
    expect(stats.histogram.bins[9]!.count).toBe(1);

    // p1: s1 completed, s2 missing. p2: s1 pending, s2 missing.
    expect(statusFor(stats, 'p1')['completed']).toBe(1);
    expect(statusFor(stats, 'p1')['missing']).toBe(1);
    expect(statusFor(stats, 'p2')['pending']).toBe(1);
    expect(statusFor(stats, 'p2')['missing']).toBe(1);

    // Attempts-to-solve: s1 solved p1 on the first try; p2 never solved (still pending).
    expect(stats.attemptsToSolve.solvedCount).toBe(1);
    expect(stats.attemptsToSolve.unsolvedCount).toBe(1);
    // First-attempt success on p1: s1 got it right first try.
    const p1 = stats.problems.find((p) => p.id === 'p1')!;
    expect(p1.firstAttemptCorrect).toBe(1);
    expect(p1.firstAttemptSubmitted).toBe(1);
  });

  it('only counts students who are actually assigned', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(
      baseAssignment({ assignedToEveryone: false, assignees: [{ userId: 's1', groupId: null }] }),
    );
    prismaMock.roster.findMany.mockResolvedValue([{ userId: 's1' }, { userId: 's2' }]);

    const stats = (await getAssignmentStatistics('c1', 'a1'))!;
    expect(stats.participantCount).toBe(1); // only s1 is assigned
  });
});

describe('getAssignmentStatistics - group assignment', () => {
  it('measures in groups, aggregates member grades, and reports queue status', async () => {
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
    prismaMock.assignmentOverride.findMany.mockResolvedValue([
      { targetType: 'GROUP', userId: null, groupId: 'g2' },
    ]);
    // g1's submissions: p1 completed, p2 failed. g2 never submitted.
    prismaMock.submission.findMany.mockResolvedValue([
      {
        studentId: 'u1',
        studentGroupId: 'g1',
        problemId: 'p1',
        submittedAt: new Date('2026-08-01T10:00:00Z'),
        correct: true,
        status: 'COMPLETED',
      },
      {
        studentId: 'u1',
        studentGroupId: 'g1',
        problemId: 'p2',
        submittedAt: new Date('2026-08-01T11:00:00Z'),
        correct: false,
        status: 'FAILED',
      },
    ]);

    const stats = (await getAssignmentStatistics('c1', 'a1'))!;

    expect(stats.unit).toBe('group');
    expect(stats.participantCount).toBe(2); // g1 + g2, gEmpty excluded
    expect(stats.exceptionCount).toBe(1); // g2

    // g1 graded 100% -> included; g2 ungraded -> excluded
    expect(stats.histogram.includedCount).toBe(1);
    expect(stats.histogram.bins[9]!.count).toBe(1);

    // p1: g1 completed, g2 missing. p2: g1 failed, g2 missing.
    expect(statusFor(stats, 'p1')['completed']).toBe(1);
    expect(statusFor(stats, 'p1')['missing']).toBe(1);
    expect(statusFor(stats, 'p2')['failed']).toBe(1);
    expect(statusFor(stats, 'p2')['missing']).toBe(1);
  });
});

it('returns null when the assignment is not in the course', async () => {
  prismaMock.assignment.findFirst.mockResolvedValue(null);
  expect(await getAssignmentStatistics('c1', 'missing')).toBeNull();
});
