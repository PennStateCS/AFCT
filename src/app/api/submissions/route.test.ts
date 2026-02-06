import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  assignmentProblem: { findUnique: vi.fn() },
  submission: { create: vi.fn() },
}));

const verifyTokenMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());

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
vi.mock('os', () => ({ platform: vi.fn().mockReturnValue('linux') }));
vi.mock('../../../../lib/java-runner', () => ({
  default: vi.fn().mockImplementation(() => ({ execute: vi.fn() })),
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
});

describe('POST /api/submissions', () => {
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
    const req = new NextRequest('http://localhost/api/submissions', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: formData,
    });

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

    const req = new NextRequest('http://localhost/api/submissions', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: formData,
    });

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

    const req = new NextRequest('http://localhost/api/submissions', {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      body: formData,
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.submission.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });
});
