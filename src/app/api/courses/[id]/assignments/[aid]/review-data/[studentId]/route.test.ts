import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  assignment: { findFirst: vi.fn() },
  roster: { findFirst: vi.fn() },
  assignmentProblem: { findMany: vi.fn() },
  comment: { findMany: vi.fn() },
  assignmentProblemGrade: { findMany: vi.fn() },
  submission: { findMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());
const resolveGroupMock = vi.hoisted(() => vi.fn());
const contentGateMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: logMock }));
vi.mock('@/lib/assignment-groups', () => ({
  resolveStudentSubmissionGroupId: resolveGroupMock,
}));
vi.mock('@/lib/assignment-student-gate', () => ({
  resolveStudentContentGate: contentGateMock,
}));

import { Prisma } from '@prisma/client';
import { GET } from './route';

const params = { id: 'course-1', aid: 'assignment-1', studentId: 'student-1' };

describe('GET /api/courses/[id]/[aid]/review-data/[studentId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authMock.mockResolvedValue({ user: { id: 'faculty-1', role: 'FACULTY' } });
    // Assigned and unlocked by default; the gating tests override this.
    contentGateMock.mockResolvedValue({ assigned: true, locked: false, unlockAt: null });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: params.aid, isPublished: true });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-1', role: 'FACULTY' });
    prismaMock.assignmentProblem.findMany.mockResolvedValue([
      {
        problem: {
          id: 'p1',
          title: 'P1',
          description: null,
          type: 'FA',
          maxStates: null,
          isDeterministic: null,
          originalFileName: null,
        },
      },
    ]);
    prismaMock.comment.findMany.mockResolvedValue([]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([]);
    prismaMock.submission.findMany.mockResolvedValue([]);
    logMock.mockResolvedValue(undefined);
    // Individual submission by default; group-aware tests override this.
    resolveGroupMock.mockResolvedValue(null);
  });

  it('returns 401 for unauthenticated requests', async () => {
    authMock.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when non-admin is not enrolled in the course', async () => {
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(403);
  });

  it('returns 403 when a student requests another student’s review data', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-2', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(403);
  });

  it('allows a student to view their own review data', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-1', role: 'STUDENT', course: { isPublished: true } });

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(200);
  });

  it('404-masks an assignment the student is not assigned', async () => {
    // Published and their own id is not enough: they must actually be assigned it.
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-1', role: 'STUDENT', course: { isPublished: true } });
    contentGateMock.mockResolvedValue({ assigned: false, locked: true, unlockAt: null });

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(404);
    expect(prismaMock.assignmentProblem.findMany).not.toHaveBeenCalled();
  });

  it('withholds problem content before the student unlock time', async () => {
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-1', role: 'STUDENT', course: { isPublished: true } });
    contentGateMock.mockResolvedValue({
      assigned: true,
      locked: true,
      unlockAt: new Date('2099-01-01T00:00:00.000Z'),
    });

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      submissions: {},
      comments: [],
      problemGrades: {},
      isGroup: false,
      locked: true,
    });
    expect(prismaMock.assignmentProblem.findMany).not.toHaveBeenCalled();
  });

  it('does not gate staff on assignment membership or unlock', async () => {
    // Default auth in beforeEach is faculty.
    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(200);
    expect(contentGateMock).not.toHaveBeenCalled();
  });

  it('404-masks an unpublished assignment for the owning student', async () => {
    // Even their OWN data: a student can't read review data (problem content) for
    // an unpublished assignment.
    authMock.mockResolvedValue({ user: { id: 'student-1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-1', role: 'STUDENT', course: { isPublished: true } });
    prismaMock.assignment.findFirst.mockResolvedValue({ id: params.aid, isPublished: false });

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(404);
    expect(prismaMock.submission.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 when assignment is not found in the course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(404);
  });

  it('returns combined submissions/comments/problemGrades payload', async () => {
    const submittedAt = new Date('2026-03-01T10:00:00.000Z');
    const updatedAt = new Date('2026-03-01T11:00:00.000Z');
    const createdAt = new Date('2026-03-01T12:00:00.000Z');

    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 'sub-1',
        submittedAt,
        feedback: 'ok',
        correct: true,
        evaluationRaw: { score: 1 },
        fileName: 'sub-1.jff',
        originalFileName: 'sub-1.jff',
        problemId: 'p1',
        studentId: 'student-1',
        student: { id: 'student-1', firstName: 'Grace', lastName: 'Hopper' },
      },
    ]);

    prismaMock.comment.findMany.mockResolvedValue([
      {
        id: 'comment-1',
        content: 'Looks good',
        createdAt,
        problemId: 'p1',
        author: {
          id: 'faculty-1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          avatar: null,
        },
        roster: { role: 'FACULTY' },
      },
    ]);

    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      {
        problemId: 'p1',
        grade: 10,
        feedback: 'Nice',
        updatedAt,
      },
    ]);

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      submissions: {
        p1: {
          problem: {
            id: 'p1',
            title: 'P1',
            description: null,
            type: 'FA',
            maxStates: null,
            isDeterministic: null,
            originalFileName: null,
          },
          submissions: [
            {
              id: 'sub-1',
              submittedAt: submittedAt.toISOString(),
              feedback: 'ok',
              correct: true,
              evaluationRaw: { score: 1 },
              fileName: 'sub-1.jff',
              originalFileName: 'sub-1.jff',
              submittedBy: 'Grace Hopper',
            },
          ],
        },
      },
      isGroup: false,
      comments: [
        {
          id: 'comment-1',
          content: 'Looks good',
          createdAt: createdAt.toISOString(),
          problemId: 'p1',
          author: {
            id: 'faculty-1',
            firstName: 'Ada',
            lastName: 'Lovelace',
            avatar: null,
            cropX: null,
            cropY: null,
            zoom: null,
            role: 'FACULTY',
          },
        },
      ],
      problemGrades: {
        p1: {
          grade: 10,
          feedback: 'Nice',
          updatedAt: updatedAt.toISOString(),
        },
      },
    });
    expect(logMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'VIEW_STUDENT_REVIEW_DATA',
        category: 'SUBMISSION',
        metadata: expect.objectContaining({
          viewedStudentId: 'student-1',
          source: 'review-data',
        }),
      }),
    );
  });

  it('returns 403 when an enrolled student requests another student’s data', async () => {
    // Enrolled as a plain student (read access granted by the wrapper) but neither
    // the owner nor a manager -> hits the in-handler denial after the 404 check.
    authMock.mockResolvedValue({ user: { id: 'student-2', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-2', role: 'STUDENT', course: { isPublished: true } });

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(403);
    // Reaches the handler (assignment lookup) before denying.
    expect(prismaMock.assignment.findFirst).toHaveBeenCalled();
    // The denial log carries an explicit category (the action has no domain keyword).
    expect(logMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'REVIEW_DATA_ACCESS_DENIED',
        category: 'SUBMISSION',
        courseId: 'course-1',
      }),
    );
  });

  it('coerces null author fields and null grade/feedback to null', async () => {
    prismaMock.comment.findMany.mockResolvedValue([
      {
        id: 'comment-1',
        content: 'note',
        createdAt: new Date('2026-03-01T12:00:00.000Z'),
        problemId: 'p1',
        author: {
          id: 'u-9',
          firstName: null,
          lastName: null,
          avatar: null,
        },
        roster: null,
      },
    ]);
    prismaMock.assignmentProblemGrade.findMany.mockResolvedValue([
      {
        problemId: 'p1',
        grade: null,
        feedback: null,
        updatedAt: new Date('2026-03-01T11:00:00.000Z'),
      },
    ]);

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.comments[0].author).toEqual({
      id: 'u-9',
      firstName: null,
      lastName: null,
      avatar: null,
      cropX: null,
      cropY: null,
      zoom: null,
      role: null,
    });
    expect(json.problemGrades.p1).toMatchObject({ grade: null, feedback: null });
  });

  it('still returns 200 when activity logging fails', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logMock.mockRejectedValueOnce(new Error('log down'));

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(200);
    consoleSpy.mockRestore();
  });

  it('returns 500 when a submission error is not the evaluationRaw fallback case', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // A non-P2022 error must be rethrown and surface as a 500.
    prismaMock.submission.findMany.mockRejectedValueOnce(new Error('db down'));

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(500);
    // Only the original query ran; the fallback was not attempted.
    expect(prismaMock.submission.findMany).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('rethrows a P2022 for a different column (no fallback)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p2022 = new Prisma.PrismaClientKnownRequestError('missing column', {
      code: 'P2022',
      clientVersion: 'test',
      meta: { column: 'Submission.someOtherColumn' },
    });
    prismaMock.submission.findMany.mockRejectedValueOnce(p2022);

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(500);
    expect(prismaMock.submission.findMany).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('widens the submissions query to the group set when the student is group-assigned', async () => {
    resolveGroupMock.mockResolvedValue('group-1');
    prismaMock.submission.findMany.mockResolvedValue([
      {
        id: 'group-sub',
        submittedAt: new Date('2026-03-01T10:00:00.000Z'),
        feedback: 'ok',
        correct: true,
        evaluationRaw: null,
        fileName: 'g.jff',
        originalFileName: 'g.jff',
        problemId: 'p1',
        studentId: 'teammate-9',
        student: { id: 'teammate-9', firstName: 'Kata', lastName: 'Rin' },
      },
    ]);

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(200);
    expect(resolveGroupMock).toHaveBeenCalledWith(params.aid, params.studentId);
    // The submissions fetch ORs the student's own rows with the group's set...
    expect(prismaMock.submission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assignmentId: params.aid,
          OR: [{ studentId: params.studentId }, { studentGroupId: 'group-1' }],
        },
      }),
    );
    // ...and the grade read stays per-student (unchanged).
    expect(prismaMock.assignmentProblemGrade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { assignmentId: params.aid, studentId: params.studentId } }),
    );
    const json = await res.json();
    expect(json.submissions.p1.submissions[0].id).toBe('group-sub');
    // Group assignment => flag set and the submitter (a groupmate) is named.
    expect(json.isGroup).toBe(true);
    expect(json.submissions.p1.submissions[0].submittedBy).toBe('Kata Rin');
  });

  it('falls back when evaluationRaw column is unavailable', async () => {
    const p2022 = new Prisma.PrismaClientKnownRequestError('missing column', {
      code: 'P2022',
      clientVersion: 'test',
      meta: { column: 'Submission.evaluationRaw' },
    });

    prismaMock.submission.findMany.mockRejectedValueOnce(p2022).mockResolvedValueOnce([
      {
        id: 'sub-1',
        submittedAt: new Date('2026-03-01T10:00:00.000Z'),
        feedback: null,
        correct: null,
        fileName: 'sub-1.jff',
        originalFileName: 'sub-1.jff',
        problemId: 'p1',
      },
    ]);

    const res = await GET(new Request('http://localhost'), { params: Promise.resolve(params) });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.submissions.p1.submissions[0].evaluationRaw).toBeNull();
    expect(prismaMock.submission.findMany).toHaveBeenCalledTimes(2);
  });
});
