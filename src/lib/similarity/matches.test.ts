import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  submission: { groupBy: vi.fn(), findMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { findSubmissionMatches } from './matches';

const student = (id: string) => ({
  id,
  firstName: id.toUpperCase(),
  lastName: 'Student',
  avatar: null,
  cropX: null,
  cropY: null,
  zoom: null,
});

const submission = (over: Record<string, unknown>) => ({
  id: 'sub',
  problemId: 'p1',
  contentHash: 'hash-a',
  assignmentId: 'a1',
  submittedAt: new Date('2026-08-14T12:00:00Z'),
  fileName: 'stored.jff',
  originalFileName: 'answer.jff',
  studentId: 's1',
  studentGroupId: null,
  student: student('s1'),
  studentGroup: null,
  ...over,
});

const problems = new Map([
  ['p1', { title: 'Even zeros', type: 'FA' }],
  ['p2', { title: 'a^n b^n', type: 'CFG' }],
]);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.submission.findMany.mockResolvedValue([]);
});

describe('findSubmissionMatches', () => {
  it('asks for nothing when the assignment has no problems', async () => {
    await expect(findSubmissionMatches([], problems)).resolves.toEqual([]);
    expect(prismaMock.submission.groupBy).not.toHaveBeenCalled();
  });

  it('reports a group when two students share the same content', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's2' },
      { problemId: 'p1', contentHash: 'hash-b', studentId: 's3' },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      submission({ id: 'sub-1', studentId: 's1', student: student('s1') }),
      submission({ id: 'sub-2', studentId: 's2', student: student('s2') }),
    ]);

    const [group, ...rest] = await findSubmissionMatches(['p1'], problems);

    expect(rest).toHaveLength(0);
    expect(group).toMatchObject({
      problem: { id: 'p1', title: 'Even zeros' },
      studentCount: 2,
      // s1, s2 and s3 all submitted this problem.
      problemStudentCount: 3,
    });
    expect(group?.submissions.map((s) => s.id)).toEqual(['sub-1', 'sub-2']);
  });

  it('does not treat one student resubmitting the same file as a match', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's1' },
    ]);

    await expect(findSubmissionMatches(['p1'], problems)).resolves.toEqual([]);
    // Nothing shared, so it never goes back for the submissions.
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });

  it('counts a student once however many times they submitted', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's2' },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      submission({ id: 'sub-1', studentId: 's1', student: student('s1') }),
      submission({ id: 'sub-2', studentId: 's1', student: student('s1') }),
      submission({ id: 'sub-3', studentId: 's2', student: student('s2') }),
    ]);

    const [group] = await findSubmissionMatches(['p1'], problems);

    expect(group?.studentCount).toBe(2);
    expect(group?.submissions).toHaveLength(3);
  });

  it('puts the rare match above the one most of the class shares', async () => {
    // p2 is a grammar everybody wrote the same way; p1 is shared by exactly two.
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's2' },
      ...['s1', 's2', 's3', 's4', 's5'].map((studentId) => ({
        problemId: 'p2',
        contentHash: 'hash-c',
        studentId,
      })),
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      submission({ id: 'sub-1', problemId: 'p1', contentHash: 'hash-a', studentId: 's1', student: student('s1') }),
      submission({ id: 'sub-2', problemId: 'p1', contentHash: 'hash-a', studentId: 's2', student: student('s2') }),
      ...['s1', 's2', 's3', 's4', 's5'].map((id, index) => ({
        ...submission({
          id: `sub-c${index}`,
          problemId: 'p2',
          contentHash: 'hash-c',
          studentId: id,
          student: student(id),
        }),
      })),
    ]);

    const groups = await findSubmissionMatches(['p1', 'p2'], problems);

    expect(groups.map((g) => [g.problem.id, g.studentCount, g.problemStudentCount])).toEqual([
      ['p1', 2, 2],
      ['p2', 5, 5],
    ]);
  });

  it('never groups across problems, even for identical content', async () => {
    // The same grammar submitted to two different problems is two separate questions.
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p2', contentHash: 'hash-a', studentId: 's2' },
    ]);

    await expect(findSubmissionMatches(['p1', 'p2'], problems)).resolves.toEqual([]);
  });

  it('says how close together two students submitted, ignoring their own resubmissions', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's2' },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      submission({
        id: 'sub-1',
        studentId: 's1',
        student: student('s1'),
        submittedAt: new Date('2026-08-14T12:00:00Z'),
      }),
      // The same student again a minute later: closer, but not two people.
      submission({
        id: 'sub-2',
        studentId: 's1',
        student: student('s1'),
        submittedAt: new Date('2026-08-14T12:01:00Z'),
      }),
      submission({
        id: 'sub-3',
        studentId: 's2',
        student: student('s2'),
        submittedAt: new Date('2026-08-14T12:06:00Z'),
      }),
    ]);

    const [group] = await findSubmissionMatches(['p1'], problems);

    expect(group?.closestGapMs).toBe(5 * 60 * 1000);
  });

  it('ignores teammates on a group assignment holding the same file', async () => {
    // Every member's submit writes its own row against the shared set, so a whole team
    // matching itself is the feature working rather than anything to report.
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's2' },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      submission({ id: 'sub-1', studentId: 's1', student: student('s1'), studentGroupId: 'g1' }),
      submission({ id: 'sub-2', studentId: 's2', student: student('s2'), studentGroupId: 'g1' }),
    ]);

    await expect(findSubmissionMatches(['p1'], problems)).resolves.toEqual([]);
  });

  it('still reports a match that reaches outside the team', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's2' },
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's3' },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      submission({ id: 'sub-1', studentId: 's1', student: student('s1'), studentGroupId: 'g1' }),
      submission({ id: 'sub-2', studentId: 's2', student: student('s2'), studentGroupId: 'g1' }),
      // Not on that team.
      submission({ id: 'sub-3', studentId: 's3', student: student('s3'), studentGroupId: null }),
    ]);

    const [group] = await findSubmissionMatches(['p1'], problems);

    expect(group?.studentCount).toBe(3);
  });

  it('only looks at submissions that have a hash', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([]);

    await findSubmissionMatches(['p1'], problems);

    expect(prismaMock.submission.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { problemId: { in: ['p1'] }, contentHash: { not: null } },
      }),
    );
  });
});
