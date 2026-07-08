import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  problem: {
    findFirst: vi.fn(),
    delete: vi.fn(),
  },
  submission: {
    deleteMany: vi.fn(),
  },
  assignmentProblem: {
    deleteMany: vi.fn(),
  },
  roster: { findFirst: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const unlinkMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      unlink: unlinkMock,
    },
    default: {
      ...actual,
      promises: {
        ...actual.promises,
        unlink: unlinkMock,
      },
    },
  };
});

import { DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.roster.findFirst.mockResolvedValue(null);
});

describe('DELETE /api/courses/[id]/problems/[pid]', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(401);
  });

  it('returns 403 when a non-staff user attempts deletion', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'STUDENT' } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Forbidden');
  });

  it('returns 404 when problem not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(404);
  });

  it('deletes problem and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'p1',
      title: 'Problem',
      fileName: 'file.jff',
    });

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(200);
    expect(prismaMock.submission.deleteMany).toHaveBeenCalledWith({ where: { problemId: 'p1' } });
    expect(prismaMock.assignmentProblem.deleteMany).toHaveBeenCalledWith({
      where: { problemId: 'p1' },
    });
    expect(prismaMock.problem.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(unlinkMock).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('skips file deletion when the problem has no file', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'FACULTY' } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'FACULTY' });
    prismaMock.problem.findFirst.mockResolvedValue({ id: 'p1', title: 'Problem', fileName: null });

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(200);
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('ignores a missing solution file (ENOENT) and still succeeds', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'p1',
      title: 'Problem',
      fileName: 'file.jff',
    });
    unlinkMock.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(200);
    expect(activityLogMock).toHaveBeenCalled();
  });

  it('logs but tolerates a non-ENOENT file deletion error', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'p1',
      title: 'Problem',
      fileName: 'file.jff',
    });
    unlinkMock.mockRejectedValue(Object.assign(new Error('permission denied'), { code: 'EACCES' }));

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(200);
  });

  it('returns 500 when a delete operation fails', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN', isAdmin: true } });
    prismaMock.problem.findFirst.mockResolvedValue({
      id: 'p1',
      title: 'Problem',
      fileName: null,
    });
    prismaMock.problem.delete.mockRejectedValue(new Error('db down'));

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(500);
  });
});
