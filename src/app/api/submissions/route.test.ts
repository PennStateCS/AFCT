import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import * as os from 'os';

const prismaMock = vi.hoisted(() => ({
  assignmentProblem: { findUnique: vi.fn() },
  submission: { create: vi.fn() },
}));

const verifyTokenMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());
const javaRunnerExecuteMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/app/utils/jwt', () => ({ verifyToken: verifyTokenMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSync = vi.fn().mockReturnValue(true);
  const mkdirSync = vi.fn();
  const writeFileSync = vi.fn();
  return {
    ...actual,
    existsSync,
    mkdirSync,
    writeFileSync,
    default: {
      ...actual,
      existsSync,
      mkdirSync,
      writeFileSync,
    },
  };
});
vi.mock('child_process', () => ({ execSync: vi.fn().mockReturnValue('1') }));
vi.mock('crypto', () => ({ randomUUID: vi.fn().mockReturnValue('uuid-1') }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    platform: vi.fn().mockReturnValue('linux'),
    default: {
      ...actual,
      platform: vi.fn().mockReturnValue('linux'),
    },
  };
});
vi.mock('../../../../lib/java-runner', () => ({
  default: vi.fn().mockImplementation(() => ({ execute: javaRunnerExecuteMock })),
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
  if (!('arrayBuffer' in File.prototype)) {
    File.prototype.arrayBuffer = async function () {
      return new Uint8Array(this.size).buffer;
    };
  }
});

describe('POST /api/submissions', () => {
  const makeFile = (size = 10, name = 'a.jff') =>
    Object.assign(new File([new Uint8Array(size)], name, { type: 'text/plain' }), {
      arrayBuffer: async () => new Uint8Array(size).buffer,
    });

  it('returns 401 when token is missing', async () => {
    verifyTokenMock.mockReturnValue(null);

    const req = new NextRequest('http://localhost/api/submissions', { method: 'POST' });
    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 400 when required fields missing', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'user-1' });

    const formData = new FormData();
    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when problem not linked to assignment', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue(null);

    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('creates a submission without a file', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    if (res.status !== 201) {
      const errorCall = activityLogMock.mock.calls.find(
        (call) => call[2]?.action === 'SUBMISSION_ERROR',
      );
      throw new Error(`Unexpected 500: ${errorCall?.[2]?.metadata?.error ?? 'unknown error'}`);
    }

    expect(res.status).toBe(201);
    expect(prismaMock.submission.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('returns 413 when file exceeds max size', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    uploadLimitMock.mockResolvedValue({ maxBytes: 1, maxMb: 0.000001 });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });

    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', makeFile(2));

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(413);
  });

  it('stores evaluator feedback when answer file exists', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    javaRunnerExecuteMock.mockResolvedValue({
      stdout: JSON.stringify({ correct: true, feedback: 'Looks good' }),
      stderr: '',
    });

    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockImplementation((p) =>
      String(p).includes('/private/uploads/solutions') ? true : true,
    );

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    if (res.status !== 201) {
      const errorCall = activityLogMock.mock.calls.find(
        (call) => call[2]?.action === 'SUBMISSION_ERROR',
      );
      throw new Error(`Unexpected 500: ${errorCall?.[2]?.metadata?.error ?? 'unknown error'}`);
    }

    expect(res.status).toBe(201);
    expect(javaRunnerExecuteMock).toHaveBeenCalled();
  });

  it('returns evaluation error when answer file missing', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockImplementation((p) =>
      String(p).includes('/private/uploads/solutions') ? false : true,
    );

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('handles FA type problem with maxStates and deterministic flags', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    javaRunnerExecuteMock.mockResolvedValue({
      stdout: JSON.stringify({ correct: false, feedback: 'States exceeded' }),
      stderr: '',
    });

    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: {
        fileName: 'answer.jff',
        maxStates: 5,
        isDeterministic: true,
        type: 'FA',
      },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(javaRunnerExecuteMock).toHaveBeenCalledWith(
      expect.arrayContaining(['5', 'true']),
      expect.any(Object),
    );
  });

  it('handles PDA type problem with maxStates', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    javaRunnerExecuteMock.mockResolvedValue({
      stdout: JSON.stringify({ correct: true, feedback: 'Correct' }),
      stderr: '',
    });

    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: {
        fileName: 'answer.jff',
        maxStates: 10,
        isDeterministic: null,
        type: 'PDA',
      },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(javaRunnerExecuteMock).toHaveBeenCalledWith(
      expect.arrayContaining(['10']),
      expect.any(Object),
    );
  });

  it('handles evaluator stderr output', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    javaRunnerExecuteMock.mockResolvedValue({
      stdout: JSON.stringify({ correct: true, feedback: 'Ok' }),
      stderr: 'Warning: some warning message',
    });

    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(201);
    const stderrLogCall = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_EVALUATION_STDERR',
    );
    expect(stderrLogCall).toBeDefined();
  });

  it('handles invalid JSON from evaluator', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    javaRunnerExecuteMock.mockResolvedValue({
      stdout: 'Not valid JSON',
      stderr: '',
    });

    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(201);
    const errorLogCall = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_EVALUATION_ERROR',
    );
    expect(errorLogCall).toBeDefined();
  });

  it('handles evaluator execution error', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    javaRunnerExecuteMock.mockRejectedValue(new Error('Timeout'));

    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(201);
    const errorLogCall = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_EVALUATION_ERROR',
    );
    expect(errorLogCall).toBeDefined();
    expect(errorLogCall?.[2]?.metadata?.error).toContain('Timeout');
  });

  it('handles missing answer file configuration', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');

    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: null, maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(201);
    const errorLogCall = activityLogMock.mock.calls.find(
      (call) =>
        call[2]?.action === 'SUBMISSION_EVALUATION_ERROR' &&
        call[2]?.metadata?.error?.includes('No answer file configured'),
    );
    expect(errorLogCall).toBeDefined();
  });

  it('handles Java stream string in feedback', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    javaRunnerExecuteMock.mockResolvedValue({
      stdout: JSON.stringify({
        correct: true,
        feedback: 'java.lang.IntStream@12345',
      }),
      stderr: '',
    });

    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.submission.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feedback: 'Evaluation completed - correct: true',
        }),
      }),
    );
  });

  it('handles non-object evaluation response', async () => {
    vi.mocked(os.platform).mockReturnValue('linux');
    javaRunnerExecuteMock.mockResolvedValue({
      stdout: '["not", "an", "object"]',
      stderr: '',
    });

    verifyTokenMock.mockReturnValue({ userId: 'user-1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    prismaMock.submission.create.mockResolvedValue({ id: 'submission-1' });

    const existsSyncMock = vi.mocked(fs.existsSync);
    existsSyncMock.mockReturnValue(true);

    const file = makeFile(10, 'submission.jff');
    const formData = new FormData();
    formData.set('courseId', 'course-1');
    formData.set('assignmentId', 'assignment-1');
    formData.set('problemId', 'problem-1');
    formData.set('file', file);

    const req = {
      headers: new Headers({ authorization: 'Bearer token' }),
      formData: async () => formData,
    } as unknown as NextRequest;

    const res = await POST(req);

    expect(res.status).toBe(201);
    // Arrays are objects in JS, so it treats as success but without correct/feedback fields
    const successLogCall = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_EVALUATION_SUCCESS',
    );
    expect(successLogCall).toBeDefined();
  });
});
