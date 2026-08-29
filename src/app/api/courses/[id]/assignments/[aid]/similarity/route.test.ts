import { beforeEach, describe, expect, it, vi } from 'vitest';

// The gate cases come from Edwin Kimsal's first version of this route; the body they guard
// changed from a stored suspicion flag to read-time matching, the authorization did not.
const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  course: { findUnique: vi.fn() },
  assignment: { findFirst: vi.fn(), findUnique: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
  submission: { groupBy: vi.fn(), findMany: vi.fn() },
}));
const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET } from './route';
import { clusterMatches, isSetAside } from '@/lib/similarity/evidence';
import { COMMON_SHARE } from '@/lib/similarity/rarity';

const req = () => new Request('http://localhost/api/courses/c1/assignments/a1/similarity');
const ctx = () => ({ params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
const call = () => GET(req(), ctx());
const callCount = () =>
  GET(
    new Request('http://localhost/api/courses/c1/assignments/a1/similarity?part=count'),
    ctx(),
  );

const student = (id: string) => ({
  id,
  firstName: id,
  lastName: 'Student',
  avatar: null,
  cropX: null,
  cropY: null,
  zoom: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
  prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY', course: { deletedAt: null } });
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false, deletedAt: null });
  prismaMock.assignment.findFirst.mockResolvedValue({
    id: 'a1',
    courseId: 'c1',
    isPublished: true,
  });
  // Individual assignment unless a case says otherwise: no group set.
  prismaMock.assignment.findUnique.mockResolvedValue({ groupSetId: null });
  prismaMock.assignmentProblem.findMany.mockResolvedValue([
    { problemId: 'p1', problem: { title: 'Even zeros', type: 'FA' } },
  ]);
  prismaMock.submission.groupBy.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
});

describe('GET /api/courses/[id]/assignments/[aid]/similarity', () => {
  it('401s when signed out', async () => {
    authMock.mockResolvedValue(null);

    expect((await call()).status).toBe(401);
    expect(prismaMock.submission.groupBy).not.toHaveBeenCalled();
  });

  it('403s for a student in the course', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({
      role: 'STUDENT',
      course: { deletedAt: null },
    });

    expect((await call()).status).toBe(403);
    expect(prismaMock.submission.groupBy).not.toHaveBeenCalled();
  });

  it('allows a TA, who is course staff', async () => {
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'TA', course: { deletedAt: null } });

    expect((await call()).status).toBe(200);
  });

  it('404s for an assignment that belongs to another course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    expect((await call()).status).toBe(404);
    expect(prismaMock.submission.groupBy).not.toHaveBeenCalled();
  });

  it('only ever searches this assignment’s own problems', async () => {
    await call();

    expect(prismaMock.submission.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ problemId: { in: ['p1'] } }) }),
    );
  });

  it('returns the groups with the ratio a reader judges them by', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', contentHash: 'hash-a', studentId: 's2' },
      { problemId: 'p1', contentHash: 'hash-b', studentId: 's3' },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        problemId: 'p1',
        contentHash: 'hash-a',
        assignmentId: 'a1',
        submittedAt: new Date('2026-08-14T12:00:00Z'),
        fileName: 'stored.jff',
        originalFileName: 'answer.jff',
        student: student('s1'),
        studentGroup: null,
      },
      {
        id: 'sub-2',
        problemId: 'p1',
        contentHash: 'hash-a',
        assignmentId: 'a1',
        submittedAt: new Date('2026-08-14T11:00:00Z'),
        fileName: 'stored2.jff',
        originalFileName: 'mine.jff',
        student: student('s2'),
        studentGroup: null,
      },
    ]);

    const body = await (await call()).json();

    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      problem: { id: 'p1', title: 'Even zeros' },
      studentCount: 2,
      problemStudentCount: 3,
    });
    // Never a verdict: no field here says suspicious, and none is stored on the submission.
    expect(JSON.stringify(body)).not.toContain('uspicious');
  });

  it('answers the tab badge with counts and no names', async () => {
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', shapeHash: 'shape-a', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', shapeHash: 'shape-a', contentHash: 'hash-a', studentId: 's2' },
      { problemId: 'p1', shapeHash: 'shape-b', contentHash: 'hash-b', studentId: 's3' },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        problemId: 'p1',
        contentHash: 'hash-a',
        shapeHash: 'shape-a',
        assignmentId: 'a1',
        submittedAt: new Date('2026-08-14T12:00:00Z'),
        correct: true,
        // The mark existed before the second student submitted, which is what the reuse
        // count is about.
        evaluatedAt: new Date('2026-08-14T12:05:00Z'),
        fileName: 'stored.jff',
        originalFileName: 'answer.jff',
        studentId: 's1',
        studentGroupId: null,
        student: student('s1'),
        studentGroup: null,
      },
      {
        id: 'sub-2',
        problemId: 'p1',
        contentHash: 'hash-a',
        shapeHash: 'shape-a',
        assignmentId: 'a1',
        submittedAt: new Date('2026-08-14T12:30:00Z'),
        correct: true,
        evaluatedAt: new Date('2026-08-14T12:35:00Z'),
        fileName: 'stored2.jff',
        originalFileName: 'mine.jff',
        studentId: 's2',
        studentGroupId: null,
        student: student('s2'),
        studentGroup: null,
      },
    ]);

    const body = await (await callCount()).json();

    expect(body).toEqual({ matches: 1, notable: 0, reusedAfterPass: 1 });
    // 2 of 3 students is most of them, so it is Common and not notable, but it IS reuse.
    expect(JSON.stringify(body)).not.toContain('s1');
  });

  it('counts groups of students for the badge, not pairs', async () => {
    // s2 shares one attempt with s1 and another with s3. That is two matches and one
    // situation, and the badge has to agree with the page, which shows one card.
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', shapeHash: 'shape-a', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', shapeHash: 'shape-a', contentHash: 'hash-a', studentId: 's2' },
      { problemId: 'p1', shapeHash: 'shape-b', contentHash: 'hash-b', studentId: 's2' },
      { problemId: 'p1', shapeHash: 'shape-b', contentHash: 'hash-b', studentId: 's3' },
      // Enough of a cohort that two students sharing work is not the expected answer.
      ...['s4', 's5', 's6', 's7', 's8', 's9'].map((studentId) => ({
        problemId: 'p1',
        shapeHash: `shape-${studentId}`,
        contentHash: `hash-${studentId}`,
        studentId,
      })),
    ]);
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        problemId: 'p1',
        contentHash: 'hash-a',
        shapeHash: 'shape-a',
        assignmentId: 'a1',
        submittedAt: new Date('2026-08-14T12:00:00Z'),
        correct: false,
        fileName: 'stored-1.jff',
        originalFileName: 'mine.jff',
        studentId: 's1',
        studentGroupId: null,
        student: student('s1'),
        studentGroup: null,
      },
      {
        id: 'sub-2',
        problemId: 'p1',
        contentHash: 'hash-a',
        shapeHash: 'shape-a',
        assignmentId: 'a1',
        submittedAt: new Date('2026-08-14T13:00:00Z'),
        correct: false,
        fileName: 'stored-2.jff',
        originalFileName: 'mine.jff',
        studentId: 's2',
        studentGroupId: null,
        student: student('s2'),
        studentGroup: null,
      },
      {
        id: 'sub-3',
        problemId: 'p1',
        contentHash: 'hash-b',
        shapeHash: 'shape-b',
        assignmentId: 'a1',
        submittedAt: new Date('2026-08-14T14:00:00Z'),
        correct: false,
        fileName: 'stored-3.jff',
        originalFileName: 'mine.jff',
        studentId: 's2',
        studentGroupId: null,
        student: student('s2'),
        studentGroup: null,
      },
      {
        id: 'sub-4',
        problemId: 'p1',
        contentHash: 'hash-b',
        shapeHash: 'shape-b',
        assignmentId: 'a1',
        submittedAt: new Date('2026-08-14T15:00:00Z'),
        correct: false,
        fileName: 'stored-4.jff',
        originalFileName: 'mine.jff',
        studentId: 's3',
        studentGroupId: null,
        student: student('s3'),
        studentGroup: null,
      },
    ]);

    const body = await (await callCount()).json();

    expect(body.matches).toBe(2);
    expect(body.notable).toBe(1);

    // And the badge agrees with the page it points at: the same relationships come back from
    // the full request, and clustering them under the same default threshold gives the same
    // one group. A count produced by a cheaper rule of its own could drift from this.
    const groups = await (await call()).json();
    expect(groups).toHaveLength(body.matches);
    expect(clusterMatches(groups, COMMON_SHARE).filter((c) => !isSetAside(c.type))).toHaveLength(
      body.notable,
    );
  });

  it('sets aside a common answer in the badge count as well as on the page', async () => {
    // Two of three students, which is past the default threshold: expected work, not a
    // finding, and the badge must not advertise it.
    prismaMock.submission.groupBy.mockResolvedValue([
      { problemId: 'p1', shapeHash: 'shape-a', contentHash: 'hash-a', studentId: 's1' },
      { problemId: 'p1', shapeHash: 'shape-a', contentHash: 'hash-a', studentId: 's2' },
      { problemId: 'p1', shapeHash: 'shape-b', contentHash: 'hash-b', studentId: 's3' },
    ]);
    prismaMock.submission.findMany.mockResolvedValue(
      ['s1', 's2'].map((studentId, index) => ({
        id: `sub-${index}`,
        problemId: 'p1',
        contentHash: 'hash-a',
        shapeHash: 'shape-a',
        assignmentId: 'a1',
        submittedAt: new Date(`2026-08-14T1${index}:00:00Z`),
        correct: false,
        evaluatedAt: null,
        fileName: `stored-${index}.jff`,
        originalFileName: 'mine.jff',
        studentId,
        studentGroupId: null,
        student: student(studentId),
        studentGroup: null,
      })),
    );

    const body = await (await callCount()).json();

    expect(body.matches).toBe(1);
    expect(body.notable).toBe(0);
  });

  it('writes no access entry for a count, which discloses nobody', async () => {
    await callCount();

    expect(activityLogMock).not.toHaveBeenCalled();
  });

  it('records that staff looked, with counts rather than names', async () => {
    await call();

    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        userId: 'u1',
        action: 'ASSIGNMENT_SIMILARITY_VIEWED',
        category: 'SUBMISSION',
        courseId: 'c1',
        assignmentId: 'a1',
        metadata: { matchGroups: 0, matchedSubmissions: 0, nearMatches: 0 },
      }),
    );
  });
});
