import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  assignment: { findFirst: vi.fn(), create: vi.fn() },
  assignmentProblem: { create: vi.fn() },
  problem: { create: vi.fn() },
  $transaction: vi.fn(),
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

const sourceAssignment = {
  id: 'a1',
  dueDate: new Date('2026-03-10T00:00:00.000Z'),
  unlockAt: null,
  allowLateSubmissions: true,
  lateCutoff: new Date('2026-03-12T00:00:00.000Z'),
  problems: [
    {
      maxPoints: 40,
      maxSubmissions: 3,
      autograderEnabled: false,
      problem: {
        id: 'p1',
        title: 'Pipelining Lab',
        description: 'Do the thing',
        type: 'FA',
        maxStates: 5,
        isDeterministic: true,
        fileName: 'stored-p1.jff',
        originalFileName: 'pipelining.jff',
      },
    },
  ],
};

const call = (body: unknown) =>
  POST(
    new Request('http://localhost/api/courses/dest/assignments/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'dest' }) },
  );

const validBody = (over: Record<string, unknown> = {}) => ({
  sourceCourseId: 'src',
  sourceAssignmentId: 'a1',
  title: 'Imported Lab',
  problemMode: 'copy',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  // Admin path: canManageCourse/isCourseArchived read the course row.
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false, deletedAt: null });
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.assignment.findFirst.mockResolvedValue(sourceAssignment);
  prismaMock.assignment.create.mockResolvedValue({ id: 'a2', title: 'Imported Lab' });
  prismaMock.problem.create.mockResolvedValue({ id: 'p2' });
  prismaMock.assignmentProblem.create.mockResolvedValue({ id: 'ap2' });
  prismaMock.$transaction.mockImplementation((fn: (tx: typeof prismaMock) => unknown) =>
    fn(prismaMock),
  );
  fsMock.existsSync.mockReturnValue(true);
});

describe('POST /api/courses/[id]/assignments/import', () => {
  it('rejects importing from the same course (use Duplicate instead)', async () => {
    const res = await call(validBody({ sourceCourseId: 'dest' }));
    expect(res.status).toBe(400);
    expect(prismaMock.assignment.create).not.toHaveBeenCalled();
  });

  it('imports with copied problems, reset to unpublished/everyone/individual', async () => {
    const res = await call(validBody());
    expect(res.status).toBe(201);

    // Solution file copied for the one problem.
    expect(fsMock.copyFile).toHaveBeenCalledTimes(1);
    expect(prismaMock.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Imported Lab',
          isPublished: false,
          assignedToEveryone: true,
          groupSetId: null,
          courseId: 'dest',
          // Schedule copied from the source.
          dueDate: sourceAssignment.dueDate,
          lateCutoff: sourceAssignment.lateCutoff,
        }),
      }),
    );
    // The problem is copied into the destination course.
    expect(prismaMock.problem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Pipelining Lab',
          fileName: 'copied-uuid.jff',
          courseId: 'dest',
        }),
      }),
    );
    expect(prismaMock.assignmentProblem.create).toHaveBeenCalledTimes(1);
  });

  it('imports without problems when problemMode is none', async () => {
    const res = await call(validBody({ problemMode: 'none' }));
    expect(res.status).toBe(201);
    expect(fsMock.copyFile).not.toHaveBeenCalled();
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
    expect(prismaMock.assignmentProblem.create).not.toHaveBeenCalled();
  });

  it('returns 404 when the source assignment is not in the source course', async () => {
    prismaMock.assignment.findFirst.mockResolvedValue(null);
    const res = await call(validBody());
    expect(res.status).toBe(404);
    expect(prismaMock.assignment.create).not.toHaveBeenCalled();
  });

  it('rejects a non-staff caller (wrapper denies the destination)', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', isAdmin: false } });
    // Not on the destination roster as staff.
    prismaMock.roster.findFirst.mockResolvedValue({ role: 'STUDENT', course: { deletedAt: null } });
    const res = await call(validBody());
    expect(res.status).toBe(403);
    expect(prismaMock.assignment.create).not.toHaveBeenCalled();
  });

  it('denies a caller who manages the destination but not the source course', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', isAdmin: false } });
    // Faculty in the destination, absent from the source roster.
    prismaMock.roster.findFirst.mockImplementation(({ where }: { where: { courseId: string } }) =>
      where.courseId === 'dest'
        ? { role: 'FACULTY', course: { deletedAt: null } }
        : null,
    );
    const res = await call(validBody());
    expect(res.status).toBe(403);
    expect(logDenialMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'ASSIGNMENT_IMPORT_DENIED' }),
    );
    expect(prismaMock.assignment.create).not.toHaveBeenCalled();
  });
});
