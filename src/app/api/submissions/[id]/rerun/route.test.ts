import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const prismaMock = vi.hoisted(() => ({
  submission: { findUnique: vi.fn(), update: vi.fn() },
  assignment: { findUnique: vi.fn() },
  assignmentProblem: { findUnique: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

const existsSyncMock = vi.hoisted(() => vi.fn());
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    default: {
      ...actual,
      existsSync: existsSyncMock,
    },
  };
});

const executeMock = vi.hoisted(() => vi.fn());
vi.mock('../../../../../../lib/java-runner', () => ({
  default: vi.fn().mockImplementation(() => ({ execute: executeMock })),
}));

import { POST } from './route';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CFGANALYZER_BINARY = '/app/bin/cfganalyzer';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('POST /api/submissions/[id]/rerun', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when forbidden', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 404 when submission not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.submission.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(404);
  });

  it('returns 400 when submission has no file', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      assignmentId: 'a1',
      problemId: 'p1',
      studentId: 'u2',
      fileName: null,
      originalFileName: null,
    });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 404 when submission file missing', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      assignmentId: 'a1',
      problemId: 'p1',
      studentId: 'u2',
      fileName: 'sub.txt',
      originalFileName: 'sub.txt',
    });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    existsSyncMock.mockImplementation((filePath: string) => {
      const normalized = filePath.toString();
      if (normalized.includes('submissions')) return false;
      return true;
    });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(404);
  });

  it('reruns evaluation and updates submission', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      assignmentId: 'a1',
      problemId: 'p1',
      studentId: 'u2',
      fileName: 'sub.txt',
      originalFileName: 'sub.txt',
    });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue({
      problem: { fileName: 'answer.jff', maxStates: null, isDeterministic: null, type: 'RE' },
    });
    existsSyncMock.mockReturnValue(true);
    executeMock.mockResolvedValue({ stdout: '{"correct":true,"feedback":"ok"}', stderr: '' });
    prismaMock.submission.update.mockResolvedValue({
      id: 's1',
      feedback: 'ok',
      correct: true,
      evaluationRaw: { correct: true, feedback: 'ok' },
      updatedAt: new Date().toISOString(),
    });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(prismaMock.submission.update).toHaveBeenCalled();
  });
});
