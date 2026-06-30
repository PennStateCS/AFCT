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
  submission: { create: vi.fn() },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());
const validateStructureXMLMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
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
  validateStructureXMLMock.mockReturnValue({ isValid: true });
  prismaMock.assignmentProblem.findUnique.mockResolvedValue({
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
  });
  prismaMock.roster.findFirst.mockResolvedValue({ id: 'roster-1' });
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

  it('allows an admin to submit without a roster entry', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await POST(makeRequest(makeFormData()));

    expect(res.status).toBe(202);
    expect(prismaMock.roster.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.submission.create).toHaveBeenCalled();
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
