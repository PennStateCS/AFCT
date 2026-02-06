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
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const unlink = vi.fn();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      unlink,
    },
    default: {
      ...actual,
      promises: {
        ...actual.promises,
        unlink,
      },
    },
  };
});

import { DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DELETE /api/courses/[id]/problems/[pid]', () => {
  it('returns 403 when unauthorized', async () => {
    authMock.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(403);
  });

  it('returns 404 when problem not found', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
    prismaMock.problem.findFirst.mockResolvedValue(null);

    const req = new Request('http://localhost/api/courses/c1/problems/p1', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'c1', pid: 'p1' }) });

    expect(res.status).toBe(404);
  });

  it('deletes problem and logs activity', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', role: 'ADMIN' } });
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
    expect(activityLogMock).toHaveBeenCalled();
  });
});
