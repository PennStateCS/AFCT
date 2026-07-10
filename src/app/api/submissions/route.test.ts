import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

// Submissions are no longer evaluated synchronously. POST validates the request,
// stores the uploaded file, persists the submission in the PENDING state for the
// background queue to pick up, and returns 202 (Accepted). No Java execution,
// grading, or feedback parsing happens in the request path anymore.

const prismaMock = vi.hoisted(() => ({
  assignmentProblem: { findUnique: vi.fn() },
  assignment: { findUnique: vi.fn() },
  submission: { create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());
const queueSettingsMock = vi.hoisted(() => vi.fn());
const validateStructureXMLMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('@/lib/eval-config', () => ({ getQueueSettings: queueSettingsMock }));
vi.mock('@/app/utils/xmlStructureValidate', () => ({
  validateStructureXML: validateStructureXMLMock,
}));
vi.mock('fs', () => ({
  default: fsMock,
  ...fsMock,
}));
vi.mock('crypto', () => ({ randomUUID: vi.fn().mockReturnValue('uuid-1') }));

import { POST } from './route';

const FUTURE = new Date('2099-01-01T00:00:00.000Z');
const PAST = new Date('2000-01-01T00:00:00.000Z');

const makeFile = (size = 10, name = 'a.jff') =>
  Object.assign(new File([new Uint8Array(size)], name, { type: 'text/plain' }), {
    arrayBuffer: async () => new Uint8Array(size).buffer,
    text: async () => '<structure/>',
  });

const makeFormData = (
  fields: Record<string, string> = {
    courseId: 'course-1',
    assignmentId: 'assignment-1',
    problemId: 'problem-1',
  },
  file?: File,
) => {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  if (file) fd.set('file', file);
  return fd;
};

const makeRequest = (formData: FormData) =>
  ({
    headers: new Headers(),
    formData: async () => formData,
  }) as unknown as NextRequest;

const logActions = () => activityLogMock.mock.calls.map((call) => call[2]?.action);

beforeEach(() => {
  vi.clearAllMocks();
  fsMock.existsSync.mockReturnValue(true);
  authMock.mockResolvedValue({ user: { id: 'user-1' } });
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
  queueSettingsMock.mockResolvedValue({ resubmitCooldownMs: 10_000 });
  validateStructureXMLMock.mockReturnValue({ isValid: true });
  prismaMock.assignmentProblem.findUnique.mockResolvedValue({
    maxSubmissions: 1,
    problem: {
      fileName: 'answer.jff',
      maxPoints: 10,
      maxStates: null,
      autograderEnabled: true,
      isDeterministic: null,
      type: 'FA',
    },
  });
  prismaMock.assignment.findUnique.mockResolvedValue({
    id: 'assignment-1',
    courseId: 'course-1',
    dueDate: FUTURE,
    allowLateSubmissions: false,
    lateCutoff: null,
    isPublished: true,
  });
  prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { isPublished: true } });
  prismaMock.submission.findFirst.mockResolvedValue(null);
  prismaMock.submission.count.mockResolvedValue(0);
  prismaMock.submission.create.mockResolvedValue({
    id: 'submission-1',
    status: 'PENDING',
    fileName: 'uuid-1.jff',
  });
});

describe('POST /api/submissions', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(401);
    expect(logActions()).toContain('SUBMISSION_UNAUTHORIZED');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await POST(makeRequest(makeFormData({ courseId: 'course-1' })));

    expect(res.status).toBe(400);
    expect(logActions()).toContain('SUBMISSION_INVALID_REQUEST');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('returns 400 when the problem is not linked to the assignment', async () => {
    prismaMock.assignmentProblem.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('not linked');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the assignment does not exist', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(404);
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('returns 403 when the assignment is past due and late submissions are disabled', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      courseId: 'course-1',
      dueDate: PAST,
      allowLateSubmissions: false,
      lateCutoff: null,
      isPublished: true,
    });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(403);
    expect(logActions()).toContain('SUBMISSION_REJECTED_LATE');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('returns 403 when the late submission cutoff has passed', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      courseId: 'course-1',
      dueDate: PAST,
      allowLateSubmissions: true,
      lateCutoff: PAST,
      isPublished: true,
    });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(403);
    expect(logActions()).toContain('SUBMISSION_REJECTED_LATE_CUTOFF');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('returns 403 when the user is not on the course roster', async () => {
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(403);
    expect(logActions()).toContain('SUBMISSION_FORBIDDEN');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the per-problem submission limit is reached', async () => {
    // Cap is 1 (default mock) and the student already has 1 submission.
    prismaMock.submission.count.mockResolvedValue(1);

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(409);
    expect(logActions()).toContain('SUBMISSION_LIMIT_REACHED');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('does not cap staff test-submissions', async () => {
    // A faculty member submitting to test — exempt from the cap even at/over the limit.
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY', course: { isPublished: true } });
    prismaMock.submission.count.mockResolvedValue(5);

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(202);
    expect(prismaMock.submission.create).toHaveBeenCalled();
  });

  it('treats maxSubmissions <= 0 as unlimited', async () => {
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      maxSubmissions: 0,
      problem: {
        fileName: 'answer.jff',
        maxPoints: 10,
        maxStates: null,
        autograderEnabled: true,
        isDeterministic: null,
        type: 'FA',
      },
    });
    prismaMock.submission.count.mockResolvedValue(99);

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(202);
    expect(prismaMock.submission.create).toHaveBeenCalled();
  });

  it('returns 404 (and does not store) when a student submits to an unpublished assignment', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      courseId: 'course-1',
      dueDate: FUTURE,
      allowLateSubmissions: false,
      lateCutoff: null,
      isPublished: false,
    });
    // Enrolled student (roster role STUDENT): access passes, manage does not.
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { isPublished: true } });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(404);
    expect(logActions()).toContain('SUBMISSION_UNPUBLISHED_ASSIGNMENT');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('allows staff to submit to an unpublished assignment', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      courseId: 'course-1',
      dueDate: FUTURE,
      allowLateSubmissions: false,
      lateCutoff: null,
      isPublished: false,
    });
    // Course staff (FACULTY) may submit to an unpublished assignment.
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(202);
    expect(logActions()).not.toContain('SUBMISSION_UNPUBLISHED_ASSIGNMENT');
    expect(prismaMock.submission.create).toHaveBeenCalled();
  });

  it('allows an admin to submit without a roster entry', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN', isAdmin: true } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(202);
    expect(prismaMock.roster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.submission.create).toHaveBeenCalled();
  });

  it('returns 429 when resubmitting to the same problem within the cooldown', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({ submittedAt: new Date() });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
    expect(logActions()).toContain('SUBMISSION_RATE_LIMITED');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  // Branch 194 false side: a zero cooldown skips the rate-limit block entirely, so
  // a prior submission within any window is never consulted.
  it('skips the resubmit cooldown check when the cooldown is disabled', async () => {
    queueSettingsMock.mockResolvedValue({ resubmitCooldownMs: 0 });
    prismaMock.submission.findFirst.mockResolvedValue({ submittedAt: new Date() });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(202);
    expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.submission.create).toHaveBeenCalled();
  });

  // Branch 203 false side: a prior submission exists but the cooldown has already
  // elapsed, so the request proceeds instead of being rate-limited.
  it('allows resubmission when the cooldown has already elapsed', async () => {
    prismaMock.submission.findFirst.mockResolvedValue({
      submittedAt: new Date('2000-01-01T00:00:00.000Z'),
    });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(202);
    expect(logActions()).not.toContain('SUBMISSION_RATE_LIMITED');
    expect(prismaMock.submission.create).toHaveBeenCalled();
  });

  // Branch 252 true side: the SUBMISSION_REJECTED_LATE log serialises a present
  // lateCutoff (rather than the null used elsewhere).
  it('returns 403 with a serialised lateCutoff when late submissions are disabled', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      courseId: 'course-1',
      dueDate: PAST,
      allowLateSubmissions: false,
      lateCutoff: PAST,
      isPublished: true,
    });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(403);
    const rejectedLog = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_REJECTED_LATE',
    );
    expect(rejectedLog?.[2]?.metadata?.lateCutoff).toBe(PAST.toISOString());
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  // Branch 263 false side: past due, late submissions allowed, and no cutoff set, so
  // the late submission is accepted.
  it('accepts a late submission when allowed and no cutoff is set', async () => {
    prismaMock.assignment.findUnique.mockResolvedValue({
      id: 'assignment-1',
      courseId: 'course-1',
      dueDate: PAST,
      allowLateSubmissions: true,
      lateCutoff: null,
      isPublished: true,
    });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(202);
    expect(logActions()).not.toContain('SUBMISSION_REJECTED_LATE_CUTOFF');
    expect(prismaMock.submission.create).toHaveBeenCalled();
  });

  // Branch 374 true side / line 375: the upload directory does not yet exist, so it
  // is created before the file is written.
  it('creates the upload directory when it does not exist', async () => {
    fsMock.existsSync.mockReturnValue(false);

    const res = await POST(makeRequest(makeFormData(undefined, makeFile())));

    expect(res.status).toBe(202);
    expect(fsMock.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    expect(fsMock.writeFileSync).toHaveBeenCalled();
  });

  // Branch 445 false side: create fails with no file uploaded, so there is no
  // orphaned file to clean up.
  it('returns 500 without attempting file cleanup when no file was uploaded', async () => {
    prismaMock.submission.create.mockRejectedValue(new Error('db down'));

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(500);
    expect(fsMock.unlinkSync).not.toHaveBeenCalled();
    expect(logActions()).toContain('SUBMISSION_ERROR');
  });

  // Branch 466 false side: a thrown non-Error is stringified via String(error) in
  // the SUBMISSION_ERROR log.
  it('returns 500 and stringifies a non-Error thrown while creating the submission', async () => {
    prismaMock.submission.create.mockRejectedValueOnce('boom');

    const res = await POST(makeRequest(makeFormData(undefined, makeFile())));

    expect(res.status).toBe(500);
    const errorLog = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_ERROR',
    );
    expect(errorLog?.[2]?.metadata?.error).toBe('boom');
    // The orphaned upload is cleaned up since a file was written.
    expect(fsMock.unlinkSync).toHaveBeenCalled();
  });

  it('returns 400 when the uploaded file fails structure validation', async () => {
    validateStructureXMLMock.mockReturnValue({ isValid: false, error: 'Invalid structure' });

    const res = await POST(makeRequest(makeFormData(undefined, makeFile())));

    expect(res.status).toBe(400);
    expect(logActions()).toContain('SUBMISSION_INVALID_FILE_STRUCTURE');
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('returns 413 when the file exceeds the upload limit', async () => {
    uploadLimitMock.mockResolvedValue({ maxBytes: 5, maxMb: 5 });

    const res = await POST(makeRequest(makeFormData(undefined, makeFile(10))));

    expect(res.status).toBe(413);
    expect(prismaMock.submission.create).not.toHaveBeenCalled();
  });

  it('stores the file and queues a PENDING submission with 202', async () => {
    const res = await POST(makeRequest(makeFormData(undefined, makeFile())));

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toMatchObject({ id: 'submission-1', status: 'PENDING' });

    // File is written to disk and the submission is created as PENDING with no
    // evaluation results (those are produced later by the queue worker).
    expect(fsMock.writeFileSync).toHaveBeenCalled();
    expect(prismaMock.submission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          courseId: 'course-1',
          assignmentId: 'assignment-1',
          problemId: 'problem-1',
          studentId: 'user-1',
          fileName: 'uuid-1.jff',
          originalFileName: 'a.jff',
          feedback: null,
          evaluationRaw: Prisma.JsonNull,
        }),
      }),
    );

    const createdLog = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_CREATED',
    );
    expect(createdLog).toBeDefined();
    expect(createdLog?.[2]?.metadata?.status).toBe('PENDING');
  });

  it('queues a submission without a file', async () => {
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-2', status: 'PENDING' });

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(202);
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(prismaMock.submission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          studentId: 'user-1',
          fileName: null,
          originalFileName: null,
        }),
      }),
    );
  });

  it('returns 500 and logs an error when creating the submission fails', async () => {
    prismaMock.submission.create.mockRejectedValue(new Error('db down'));

    const res = await POST(makeRequest(makeFormData(undefined, makeFile())));

    expect(res.status).toBe(500);
    expect(logActions()).toContain('SUBMISSION_ERROR');
  });
});
