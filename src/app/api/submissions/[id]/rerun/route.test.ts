import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The rerun endpoint no longer evaluates submissions synchronously. It validates
// the request, resets the submission to PENDING so the background queue picks it
// up, logs the action and returns 202 (Accepted).

const prismaMock = vi.hoisted(() => ({
  submission: { findUnique: vi.fn(), update: vi.fn() },
  assignment: { findUnique: vi.fn() },
  assignmentProblem: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';

const makeRequest = () =>
  new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });

const submissionRecord = {
  id: 's1',
  courseId: 'c1',
  assignmentId: 'a1',
  problemId: 'p1',
  studentId: 'u2',
  fileName: 'sub.txt',
  originalFileName: 'sub.txt',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('POST /api/submissions/[id]/rerun', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(401);
    expect(prismaMock.submission.update).not.toHaveBeenCalled();
  });

  it('returns 403 when the user role is not allowed', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.submission.findUnique.mockResolvedValue(submissionRecord);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(403);
    expect(prismaMock.submission.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the submission does not exist', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.submission.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 400 when the submission has no file', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.submission.findUnique.mockResolvedValue({ ...submissionRecord, fileName: null });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(400);
    expect(prismaMock.submission.update).not.toHaveBeenCalled();
  });

  it('returns 400 when the problem is not linked to the assignment', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.submission.findUnique.mockResolvedValue(submissionRecord);
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(400);
    expect(prismaMock.submission.update).not.toHaveBeenCalled();
  });

  it('queues the submission and returns 202', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.submission.findUnique.mockResolvedValue(submissionRecord);
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    const updated = { ...submissionRecord, status: 'PENDING', feedback: null, correct: null };
    prismaMock.submission.update.mockResolvedValue(updated);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.submission).toMatchObject({ id: 's1', status: 'PENDING' });

    // Submission is reset to PENDING with cleared evaluation results.
    expect(prismaMock.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1' },
        data: expect.objectContaining({
          status: 'PENDING',
          feedback: null,
          correct: null,
        }),
      }),
    );

    // The rerun is recorded in the activity log.
    const rerunLog = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_RERUN',
    );
    expect(rerunLog).toBeDefined();
    expect(rerunLog?.[2]?.metadata?.status).toBe('PENDING');
  });

  // Branch 116: the assignment lookup returns null while the problem link still
  // exists, so the rerun proceeds and the log records a null courseId via
  // `assignment?.courseId ?? null`.
  it('queues the submission with a null courseId when the assignment is missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.submission.findUnique.mockResolvedValue(submissionRecord);
    prismaMock.assignment.findUnique.mockResolvedValue(null);
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.update.mockResolvedValue({ ...submissionRecord, status: 'PENDING' });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(202);
    const rerunLog = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_RERUN',
    );
    expect(rerunLog?.[2]?.courseId).toBeNull();
  });

  it('returns 500 when resetting the submission fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.submission.findUnique.mockResolvedValue(submissionRecord);
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.update.mockRejectedValue(new Error('update failed'));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(500);
  });

  // Branch 136 false side: a thrown non-Error is logged as the 'unknown error'
  // message in the catch block.
  it('returns 500 and logs unknown error when a non-Error is thrown', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.submission.findUnique.mockResolvedValue(submissionRecord);
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.update.mockRejectedValueOnce('boom');

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(500);
    const errorLog = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_RERUN_ERROR',
    );
    expect(errorLog?.[2]?.metadata?.error).toBe('unknown error');
  });
});
