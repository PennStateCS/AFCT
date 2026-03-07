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

  it('returns 400 when problem not linked', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.submission.findUnique.mockResolvedValue({
      id: 's1',
      assignmentId: 'a1',
      problemId: 'p1',
      studentId: 'u2',
      fileName: 'sub.txt',
      originalFileName: 'sub.txt',
    });
    prismaMock.assignment.findUnique.mockResolvedValue({ courseId: 'c1' });
    prismaMock.assignmentProblem.findUnique.mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(400);
  });

  it('returns 400 when no answer file configured', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
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
      problem: { fileName: null, maxStates: null, isDeterministic: null, type: 'RE' },
    });
    existsSyncMock.mockImplementation((filePath: string) => {
      const normalized = filePath.toString();
      if (normalized.includes('submissions')) return true;
      return false;
    });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('No answer file');
  });

  it('returns 404 when answer file missing from disk', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'TA' } });
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
      if (normalized.includes('solutions')) return false;
      return true;
    });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('Answer file not found');
  });

  it('handles FA type with maxStates and deterministic', async () => {
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
      problem: { fileName: 'answer.jff', maxStates: 10, isDeterministic: true, type: 'FA' },
    });
    existsSyncMock.mockReturnValue(true);
    executeMock.mockResolvedValue({
      stdout: '{"correct":false,"feedback":"too many"}',
      stderr: '',
    });
    prismaMock.submission.update.mockResolvedValue({
      id: 's1',
      feedback: 'too many',
      correct: false,
      evaluationRaw: { correct: false, feedback: 'too many' },
      updatedAt: new Date().toISOString(),
    });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    expect(executeMock).toHaveBeenCalledWith(
      expect.arrayContaining(['10', 'true']),
      expect.any(Object),
    );
  });

  it('handles PDA type with maxStates without deterministic flag', async () => {
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
      problem: { fileName: 'answer.jff', maxStates: 7, isDeterministic: null, type: 'PDA' },
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
    const args = executeMock.mock.calls[0]?.[0] as string[];
    expect(args).toContain('7');
    expect(args).not.toContain('true');
    expect(args).not.toContain('false');
  });

  it('normalizes java stream feedback strings', async () => {
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
    executeMock.mockResolvedValue({
      stdout: '{"correct":false,"feedback":"java.lang.ProcessBuilder$NullOutputStream@123"}',
      stderr: '',
    });
    prismaMock.submission.update.mockResolvedValue({
      id: 's1',
      feedback: 'Evaluation completed - correct: false',
      correct: false,
      evaluationRaw: {
        correct: false,
        feedback: 'java.lang.ProcessBuilder$NullOutputStream@123',
      },
      updatedAt: new Date().toISOString(),
    });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.submission.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ feedback: 'Evaluation completed - correct: false' }),
      }),
    );
  });

  it('handles stderr output during evaluation', async () => {
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
    executeMock.mockResolvedValue({
      stdout: '{"correct":true,"feedback":"ok"}',
      stderr: 'Warning message',
    });
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
    const stderrCall = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_RERUN_STDERR',
    );
    expect(stderrCall).toBeDefined();
  });

  it('handles invalid JSON from evaluator', async () => {
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
    executeMock.mockResolvedValue({ stdout: 'invalid json', stderr: '' });
    prismaMock.submission.update.mockResolvedValue({
      id: 's1',
      feedback: 'ERROR: Failed to parse evaluation result - invalid json',
      correct: undefined,
      evaluationRaw: 'invalid json',
      updatedAt: new Date().toISOString(),
    });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    const errorCall = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_RERUN_ERROR',
    );
    expect(errorCall).toBeDefined();
  });

  it('handles evaluator execution error', async () => {
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
    executeMock.mockRejectedValue(new Error('Timeout'));
    prismaMock.submission.update.mockResolvedValue({
      id: 's1',
      feedback: 'ERROR: Evaluation failed - Timeout',
      correct: undefined,
      evaluationRaw: null,
      updatedAt: new Date().toISOString(),
    });

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    const errorCall = activityLogMock.mock.calls.find(
      (call) => call[2]?.action === 'SUBMISSION_RERUN_ERROR',
    );
    expect(errorCall).toBeDefined();
  });

  it('returns 500 when updating submission record fails', async () => {
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
    prismaMock.submission.update.mockRejectedValue(new Error('update failed'));

    const req = new NextRequest('http://localhost/api/submissions/s1/rerun', { method: 'POST' });
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(500);
  });
});
