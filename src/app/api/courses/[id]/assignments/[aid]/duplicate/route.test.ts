import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
  assignment: { findFirst: vi.fn(), create: vi.fn() },
  assignmentAssignee: { createMany: vi.fn() },
  assignmentOverride: { createMany: vi.fn() },
  assignmentProblem: { createMany: vi.fn(), create: vi.fn() },
  problem: { create: vi.fn() },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  copyFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/api/activity', () => ({ logError: logErrorMock }));
vi.mock('fs', () => ({
  default: {
    existsSync: fsMock.existsSync,
    promises: { copyFile: fsMock.copyFile, unlink: fsMock.unlink },
  },
}));
// Deterministic copied-file name so the duplicate-mode assertions are stable.
vi.mock('@/lib/safe-upload', () => ({
  safeStoredFilename: () => 'copied-uuid.jff',
  resolveInsideDir: (dir: string, name: string) => `${dir}/${name}`,
}));

import { POST } from './route';

// The source assignment as returned by both withAssignmentAuth's thin resolve and the
// handler's full select (extra fields are harmless to the wrapper).
const source = {
  id: 'a1',
  courseId: 'c1',
  isPublished: true,
  dueDate: new Date('2026-03-10T00:00:00.000Z'),
  unlockAt: null,
  assignedToEveryone: false,
  allowLateSubmissions: true,
  lateCutoff: new Date('2026-03-12T00:00:00.000Z'),
  groupSetId: null,
  assignees: [{ targetType: 'STUDENT', userId: 'u1', groupId: null }],
  overrides: [
    {
      targetType: 'STUDENT',
      userId: 'u1',
      groupId: null,
      unlockAt: null,
      dueDate: new Date('2026-03-15T00:00:00.000Z'),
      lateCutoff: null,
      allowLateSubmissions: null,
    },
  ],
  problems: [
    {
      problemId: 'p1',
      maxPoints: 40,
      maxSubmissions: 3,
      autograderEnabled: false,
      problem: {
        id: 'p1',
        title: 'Pipelining Lab',
        description: 'Do the thing',
        descriptionFormat: 'TIPTAP_JSON',
        descriptionJson: {
          version: 1,
          document: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Do the thing' }] }],
          },
        },
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
    new Request('http://localhost/api/courses/c1/assignments/a1/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'c1', aid: 'a1' }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  prismaMock.roster.findFirst.mockResolvedValue(null);
  prismaMock.course.findUnique.mockResolvedValue({ isArchived: false });
  prismaMock.assignment.findFirst.mockResolvedValue(source);
  prismaMock.assignment.create.mockResolvedValue({ id: 'a2', title: 'Copy', isPublished: false });
  prismaMock.problem.create.mockResolvedValue({ id: 'p2' });
  fsMock.existsSync.mockReturnValue(true);
  // The transaction runs its callback against the same mock (tx === prisma here).
  prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => unknown) =>
    fn(prismaMock),
  );
});

describe('POST /api/courses/[id]/assignments/[aid]/duplicate', () => {
  it('rejects a non-staff caller with 403', async () => {
    authMock.mockResolvedValue({ user: { id: 's1', isAdmin: false } });
    const res = await call({ title: 'Copy', problemMode: 'none' });
    expect(res.status).toBe(403);
    expect(prismaMock.assignment.create).not.toHaveBeenCalled();
  });

  it('creates the copy unpublished and copies audience + overrides', async () => {
    const res = await call({ title: 'My Copy', problemMode: 'none' });
    expect(res.status).toBe(201);

    // Always unpublished, and the type/schedule are carried over from the source.
    expect(prismaMock.assignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'My Copy',
          isPublished: false,
          groupSetId: null,
          assignedToEveryone: false,
          dueDate: source.dueDate,
          lateCutoff: source.lateCutoff,
          courseId: 'c1',
        }),
      }),
    );
    // Audience and date exceptions are duplicated.
    expect(prismaMock.assignmentAssignee.createMany).toHaveBeenCalledWith({
      data: [{ assignmentId: 'a2', targetType: 'STUDENT', userId: 'u1', groupId: null }],
    });
    expect(prismaMock.assignmentOverride.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ assignmentId: 'a2', userId: 'u1', createdById: 'admin-1' })],
    });
    // 'none' links no problems and never touches files.
    expect(prismaMock.assignmentProblem.createMany).not.toHaveBeenCalled();
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
    expect(fsMock.copyFile).not.toHaveBeenCalled();
  });

  it('link mode shares the same problems and carries the per-assignment settings', async () => {
    const res = await call({ title: 'Copy', problemMode: 'link' });
    expect(res.status).toBe(201);

    expect(prismaMock.assignmentProblem.createMany).toHaveBeenCalledWith({
      data: [
        {
          assignmentId: 'a2',
          problemId: 'p1',
          maxPoints: 40,
          maxSubmissions: 3,
          autograderEnabled: false,
        },
      ],
    });
    // No new problems and no file copies in link mode.
    expect(prismaMock.problem.create).not.toHaveBeenCalled();
    expect(fsMock.copyFile).not.toHaveBeenCalled();
  });

  it('duplicate mode copies the solution file and makes a new problem + link', async () => {
    const res = await call({ title: 'Copy', problemMode: 'duplicate' });
    expect(res.status).toBe(201);

    // The solution file is copied to a fresh name before the new Problem is created.
    expect(fsMock.copyFile).toHaveBeenCalledTimes(1);
    expect(prismaMock.problem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          title: 'Pipelining Lab',
          type: 'FA',
          fileName: 'copied-uuid.jff',
          originalFileName: 'pipelining.jff',
          courseId: 'c1',
        }),
      }),
    );
    // The new link carries over the per-assignment settings.
    expect(prismaMock.assignmentProblem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ maxPoints: 40, maxSubmissions: 3, autograderEnabled: false }),
      }),
    );
  });

  it('duplicate mode preserves a copied problem\'s rich description verbatim', async () => {
    const res = await call({ title: 'Copy', problemMode: 'duplicate' });
    expect(res.status).toBe(201);

    const data = prismaMock.problem.create.mock.calls[0][0].data;
    expect(data.descriptionFormat).toBe('TIPTAP_JSON');
    expect(data.descriptionJson).toEqual(source.problems[0].problem.descriptionJson);
    expect(data.description).toBe('Do the thing');
  });

  it('duplicate mode leaves the new problem file-less if the source file is missing on disk', async () => {
    fsMock.existsSync.mockReturnValue(false);
    const res = await call({ title: 'Copy', problemMode: 'duplicate' });
    expect(res.status).toBe(201);
    expect(fsMock.copyFile).not.toHaveBeenCalled();
    expect(prismaMock.problem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fileName: null }) }),
    );
  });

  it('rolls back copied files when the transaction fails', async () => {
    prismaMock.$transaction.mockRejectedValue(new Error('db boom'));
    const res = await call({ title: 'Copy', problemMode: 'duplicate' });
    expect(res.status).toBe(500);
    // The file copied before the failed transaction is unlinked.
    expect(fsMock.copyFile).toHaveBeenCalledTimes(1);
    expect(fsMock.unlink).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the source assignment is not in this course', async () => {
    // withAssignmentAuth resolves nothing -> 404 before the handler runs.
    prismaMock.assignment.findFirst.mockResolvedValue(null);
    const res = await call({ title: 'Copy', problemMode: 'none' });
    expect(res.status).toBe(404);
  });

  it('rejects an empty title', async () => {
    const res = await call({ title: '', problemMode: 'none' });
    expect(res.status).toBe(400);
  });
});
