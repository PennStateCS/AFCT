import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const contentGateMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
  roster: { findFirst: vi.fn() },
  submission: { findMany: vi.fn() },
  comment: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
  submissionGrant: { findMany: vi.fn() },
  groupMembership: { findFirst: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/assignment-student-gate', () => ({
  resolveStudentContentGate: contentGateMock,
}));

import { GET } from './route';

const url = 'http://localhost/api/courses/c1/assignments/a1/student-context';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.submissionGrant.findMany.mockResolvedValue([]);
  prismaMock.groupMembership.findFirst.mockResolvedValue(null);
  // Assigned and open by default; the audience/unlock cases override it.
  contentGateMock.mockResolvedValue({ assigned: true, locked: false, unlockAt: null });
});

describe('GET /api/courses/[id]/assignments/[aid]/student-context', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when the user is not on the course roster', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 404 when assignment does not exist in the course', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT', course: { isPublished: true } });
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(404);
    expect(prismaMock.assignment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'a1', courseId: 'c1' } }),
    );
  });

  it('returns grouped student context', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT', course: { isPublished: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      problems: [
        { problemId: 'p1', showFeedback: true },
        { problemId: 'p2', showFeedback: true },
      ],
    });
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 's1',
        submittedAt: new Date('2026-03-01T10:00:00.000Z'),
        grade: 95,
        feedback: 'Nice',
        correct: true,
        fileName: 'f.jff',
        originalFileName: 'orig.jff',
        problemId: 'p1',
      },
    ]);
    prismaMock.comment.findMany.mockResolvedValue([
      {
        id: 'c1',
        content: 'LGTM',
        createdAt: new Date('2026-03-01T11:00:00.000Z'),
        problemId: 'p1',
        author: { id: 'faculty-1', firstName: 'Ada', lastName: 'Lovelace' },
        roster: { role: 'FACULTY' },
      },
    ]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([{ problemId: 'p1', grade: 95 }]);

    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assignmentGrade).toBe(95);
    expect(body.submissionCount).toBe(1);
    expect(body.submissionsByProblem.p1).toHaveLength(1);
    expect(body.submissionsByProblem.p2).toHaveLength(0);
    expect(body.commentsByProblem.p1).toHaveLength(1);
    expect(body.commentsByProblem.p2).toHaveLength(0);
  });

  it('returns 404 when an unpublished assignment is requested by a student', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT', course: { isPublished: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      isPublished: false,
      problems: [],
    });

    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(404);
  });

  it('buckets submissions and comments for problems not in the assignment list', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT', course: { isPublished: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      problems: [{ problemId: 'p1' }],
    });
    // Submission/comment reference 'p2', which was not pre-seeded from the problem list.
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 's1',
        submittedAt: new Date('2026-03-01T10:00:00.000Z'),
        feedback: null,
        correct: null,
        fileName: 'f.jff',
        originalFileName: 'orig.jff',
        problemId: 'p2',
        status: 'PENDING',
      },
    ]);
    prismaMock.comment.findMany.mockResolvedValue([
      {
        id: 'c1',
        content: 'note',
        createdAt: new Date('2026-03-01T11:00:00.000Z'),
        problemId: 'p2',
        author: { id: 'admin-1', firstName: 'Al', lastName: 'Min' },
        roster: null,
      },
    ]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);

    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.submissionsByProblem.p2).toHaveLength(1);
    expect(body.commentsByProblem.p2).toHaveLength(1);
    // No grades -> assignmentGrade stays null.
    expect(body.assignmentGrade).toBeNull();
  });

  it('returns 500 when a data fetch fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1', role: 'STUDENT', course: { isPublished: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      problems: [{ problemId: 'p1' }],
    });
    prismaMock.submission.findMany.mockRejectedValue(new Error('db down'));

    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(500);
  });

  it('masks an assignment the student is not assigned as 404', async () => {
    // Course membership plus published used to be the whole check, so any enrolled
    // student who guessed a published id got back the assignment's problem ids.
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      problems: [
        { problemId: 'p1', showFeedback: true },
        { problemId: 'p2', showFeedback: true },
      ],
    });
    contentGateMock.mockResolvedValue({ assigned: false, locked: true, unlockAt: null });

    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });

    expect(res.status).toBe(404);
    // Nothing was queried for a caller who should not know it exists.
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });

  it('returns an empty locked context before the student unlock time', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      problems: [{ problemId: 'p1' }],
    });
    contentGateMock.mockResolvedValue({ assigned: true, locked: true, unlockAt: new Date() });

    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    const body = await res.json();

    // 200 rather than 404: it legitimately exists for them, it just is not open yet.
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ locked: true, submissionCount: 0, problemGrades: {} });
    // The problem ids must not come back either - they are useful keys elsewhere.
    expect(body.submissionsByProblem).toEqual({});
  });
});

/**
 * The switch that decides whether a student reads the evaluator's witness string.
 *
 * This is the route the student's problem workspace is built from, so it is the one that matters
 * most. Staff read the same route when they look at a student's page, and must keep everything.
 */
describe('GET student context, feedback visibility', () => {
  const asStudentOn = (showFeedback: boolean, submission: Record<string, unknown> = {}) => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'STUDENT',
      course: { isPublished: true },
    });
    prismaMock.assignment.findFirst.mockResolvedValue({
      id: 'a1',
      isPublished: true,
      problems: [{ problemId: 'p1', showFeedback }],
    });
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 's1',
        submittedAt: new Date('2026-03-01T10:00:00.000Z'),
        feedback: 'The string aab is accepted but should be rejected.',
        correct: false,
        status: 'COMPLETED',
        fileName: 'f.jff',
        originalFileName: 'orig.jff',
        problemId: 'p1',
        ...submission,
      },
    ]);
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
  };

  const read = async () => {
    const res = await GET(new Request(url), { params: Promise.resolve({ id: 'c1', aid: 'a1' }) });
    expect(res.status).toBe(200);
    return (await res.json()).submissionsByProblem.p1[0];
  };

  it('sends the feedback when the problem shows it', async () => {
    asStudentOn(true);

    expect(await read()).toMatchObject({
      feedback: 'The string aab is accepted but should be rejected.',
      feedbackVisible: true,
    });
  });

  it('withholds it when the problem does not', async () => {
    asStudentOn(false);

    // Null, and said to be withheld. Without the flag the workspace renders "No feedback",
    // which tells the student the evaluator had nothing to say.
    expect(await read()).toMatchObject({ feedback: null, feedbackVisible: false });
  });

  it('still explains a run that failed', async () => {
    asStudentOn(false, { status: 'FAILED', feedback: 'The file could not be parsed.' });

    expect(await read()).toMatchObject({
      feedback: 'The file could not be parsed.',
      feedbackVisible: true,
    });
  });

  it('keeps everything for staff looking at the same page', async () => {
    asStudentOn(false);
    // Course staff, reading a student's work. The feedback is stored for them by design.
    prismaMock.roster.findFirst.mockResolvedValue({
      id: 'r1',
      role: 'FACULTY',
      course: { isPublished: true },
    });

    expect(await read()).toMatchObject({
      feedback: 'The string aab is accepted but should be rejected.',
      feedbackVisible: true,
    });
  });
});
