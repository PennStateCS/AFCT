import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  problem: { findFirst: vi.fn(), create: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());
const logDenialMock = vi.hoisted(() =>
  vi.fn(() => new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })),
);
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  copyFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/api/activity', () => ({ logError: logErrorMock, logDenial: logDenialMock }));
vi.mock('fs', () => ({
  default: {
    existsSync: fsMock.existsSync,
    promises: { copyFile: fsMock.copyFile, unlink: fsMock.unlink },
  },
}));
vi.mock('@/lib/safe-upload', () => ({
  safeStoredFilename: () => 'copied-uuid.jff',
  resolveInsideDir: (dir: string, name: string) => `${dir}/${name}`,
}));

import { POST } from './route';

const sourceProblem = {
  id: 'p1',
  courseId: 'src',
  title: 'Pipelining Lab',
  description: 'Do the thing',
  type: 'FA',
  maxStates: 5,
  isDeterministic: true,
  fileName: 'stored-p1.jff',
  originalFileName: 'pipelining.jff',
};

const call = (body: unknown) =>
  POST(
    new Request('http://localhost/api/courses/dest/problems/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'dest' }) },
  );

const validBody = (over: Record<string, unknown> = {}) => ({
  sourceCourseId: 'src',
  sourceProblemId: 'p1',
  title: 'Imported Problem',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false, deletedAt: null });
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.problem.findFirst.mockResolvedValue(sourceProblem);
  prismaMock.problem.create.mockResolvedValue({ id: 'p2', title: 'Imported Problem' });
  fsMock.existsSync.mockReturnValue(true);
});

describe('POST /api/courses/[id]/problems/import', () => {
  it('rejects importing from the same course (use Duplicate instead)', async () => {
    const res = await call(validBody({ sourceCourseId: 'dest' }));
    expect(res.status).toBe(400);
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
  });

  it('imports a copy with the source settings and its own solution file', async () => {
    const res = await call(validBody({ description: 'Edited' }));
    expect(res.status).toBe(201);

    expect(fsMock.copyFile).toHaveBeenCalledTimes(1);
    expect(prismaMock.problem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Imported Problem',
          description: 'Edited',
          type: 'FA',
          maxStates: 5,
          isDeterministic: true,
          fileName: 'copied-uuid.jff',
          originalFileName: 'pipelining.jff',
          courseId: 'dest',
        }),
      }),
    );
  });

  it('imports a file-less problem when the source has no solution file', async () => {
    prismaMock.problem.findFirst.mockResolvedValue({
      ...sourceProblem,
      fileName: null,
      originalFileName: null,
    });
    const res = await call(validBody());
    expect(res.status).toBe(201);
    expect(fsMock.copyFile).not.toHaveBeenCalled();
    expect(prismaMock.problem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fileName: null, originalFileName: null }),
      }),
    );
  });

  it('rolls back the copied file when the create fails', async () => {
    prismaMock.problem.create.mockRejectedValue(new Error('db boom'));
    const res = await call(validBody());
    expect(res.status).toBe(500);
    expect(fsMock.copyFile).toHaveBeenCalledTimes(1);
    expect(fsMock.unlink).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the source problem is not in the source course', async () => {
    prismaMock.problem.findFirst.mockResolvedValue(null);
    const res = await call(validBody());
    expect(res.status).toBe(404);
  });

  it('rejects a non-staff caller (wrapper denies the destination)', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', isAdmin: false } });
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { deletedAt: null } });
    const res = await call(validBody());
    expect(res.status).toBe(403);
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
  });

  it('denies a caller who manages the destination but not the source course', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', isAdmin: false } });
    prismaMock.roster.findFirst.mockImplementation(({ where }: { where: { courseId: string } }) =>
      where.courseId === 'dest' ? { role: 'FACULTY', course: { deletedAt: null } } : null,
    );
    const res = await call(validBody());
    expect(res.status).toBe(403);
    expect(logDenialMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'PROBLEM_IMPORT_DENIED' }),
    );
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
  });
});
