import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * Direct coverage for the submission pipeline.
 *
 * This module had none: its only test consumer (the client submissions route) mocks
 * `createSubmission` out entirely and asserts delegation, so every gate below - the
 * enrollment check, the unpublished/not-assigned masking, the cap, the cooldown, the
 * deadline window, the orphan-file cleanup - was running unexercised in tests.
 *
 * The pure collaborators (`effective-deadline`, `submission-window`,
 * `assignment-visibility`) are deliberately NOT mocked. They are the interesting part
 * of several of these decisions, and stubbing them would turn "the late window is
 * enforced" into "we called a function".
 */

const prismaMock = vi.hoisted(() => ({
  assignmentProblem: { findUnique: vi.fn() },
  assignment: { findUnique: vi.fn() },
  submission: { count: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  $transaction: vi.fn(),
}));
const auditMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());
const queueSettingsMock = vi.hoisted(() => vi.fn());
const validateXmlMock = vi.hoisted(() => vi.fn());
const canAccessMock = vi.hoisted(() => vi.fn());
const canManageMock = vi.hoisted(() => vi.fn());
const isArchivedMock = vi.hoisted(() => vi.fn());
const lockGroupSetMock = vi.hoisted(() => vi.fn());
const fsMock = vi.hoisted(() => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: auditMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('@/lib/eval-config', () => ({ getQueueSettings: queueSettingsMock }));
vi.mock('@/app/utils/xmlStructureValidate', () => ({ validateStructureXML: validateXmlMock }));
vi.mock('@/lib/permissions', () => ({
  canAccessCourse: canAccessMock,
  canManageCourse: canManageMock,
  isCourseArchived: isArchivedMock,
}));
vi.mock('@/lib/group-set-service', () => ({ lockGroupSetIfUsed: lockGroupSetMock }));
vi.mock('@/lib/safe-upload', () => ({
  safeStoredFilename: () => 'stored-uuid.jff',
  resolveInsideDir: (dir: string, name: string) => `${dir}/${name}`,
}));
vi.mock('fs', () => ({ default: fsMock, ...fsMock }));

import { createSubmission } from './create-submission';

const STUDENT = { id: 'student-1', isAdmin: false };
const HOUR = 60 * 60 * 1000;
const future = (ms = 24 * HOUR) => new Date(Date.now() + ms);
const past = (ms = 24 * HOUR) => new Date(Date.now() - ms);

/** The transaction client the real code sees inside `$transaction`. */
function txClient(created: unknown, countInTx = 0) {
  return {
    submission: {
      count: vi.fn().mockResolvedValue(countInTx),
      create: vi.fn().mockResolvedValue(created),
    },
  };
}

type Overrides = {
  link?: Record<string, unknown> | null;
  assignment?: Record<string, unknown> | null;
  staff?: boolean;
  enrolled?: boolean;
  archived?: boolean;
  priorCount?: number;
  lastSubmittedAt?: Date | null;
  cooldownMs?: number;
  countInTx?: number;
};

/** Happy path by default; each test overrides only the thing it is about. */
function setup(o: Overrides = {}) {
  const created = { id: 'sub-1', status: 'PENDING' };

  prismaMock.assignmentProblem.findUnique.mockResolvedValue(
    o.link === undefined
      ? { maxSubmissions: 3, problem: { fileName: 'p.jff', type: 'FA', maxStates: null, isDeterministic: null } }
      : o.link,
  );

  prismaMock.assignment.findUnique.mockResolvedValue(
    o.assignment === undefined
      ? {
          id: 'a-1',
          courseId: 'course-1',
          unlockAt: null,
          dueDate: future(),
          allowLateSubmissions: false,
          lateCutoff: null,
          isPublished: true,
          assignedToEveryone: true,
          groupSetId: null,
          assignees: [],
          overrides: [],
        }
      : o.assignment,
  );

  canAccessMock.mockResolvedValue(o.enrolled ?? true);
  canManageMock.mockResolvedValue(o.staff ?? false);
  isArchivedMock.mockResolvedValue(o.archived ?? false);
  uploadLimitMock.mockResolvedValue({ maxBytes: 1024 * 1024, maxMb: 1 });
  queueSettingsMock.mockResolvedValue({ resubmitCooldownMs: o.cooldownMs ?? 0 });
  validateXmlMock.mockReturnValue({ isValid: true });
  prismaMock.submission.count.mockResolvedValue(o.priorCount ?? 0);
  prismaMock.submission.findFirst.mockResolvedValue(
    o.lastSubmittedAt ? { submittedAt: o.lastSubmittedAt } : null,
  );

  const tx = txClient(created, o.countInTx ?? 0);
  prismaMock.$transaction.mockImplementation(async (cb: (c: typeof tx) => unknown) => cb(tx));
  fsMock.existsSync.mockReturnValue(true);

  return { created, tx };
}

const call = (extra: Partial<Parameters<typeof createSubmission>[0]> = {}) =>
  createSubmission({
    user: STUDENT,
    assignmentId: 'a-1',
    problemId: 'p-1',
    file: null,
    req: new Request('http://localhost/api/submissions'),
    ...extra,
  });

/** The action names passed to the audit logger during this call. */
const auditActions = () => auditMock.mock.calls.map((c) => c[2].action);

beforeEach(() => {
  // resetAllMocks, NOT clearAllMocks: clear only wipes recorded calls and leaves
  // implementations in place, so a stub like the "disk full" writeFileSync below would
  // leak into every later test and make results depend on file order.
  vi.resetAllMocks();
  auditMock.mockResolvedValue(undefined);
  lockGroupSetMock.mockResolvedValue(undefined);
});

describe('createSubmission', () => {
  describe('request shape', () => {
    it.each([
      ['assignmentId missing', { assignmentId: undefined }],
      ['problemId missing', { problemId: undefined }],
    ])('rejects when %s', async (_label, extra) => {
      setup();
      const res = await call(extra);
      expect(res).toMatchObject({ ok: false, status: 400, error: 'Missing required fields' });
      expect(auditActions()).toContain('SUBMISSION_INVALID_REQUEST');
    });

    it('rejects a problem that is not linked to the assignment', async () => {
      setup({ link: null });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 400 });
      expect((res as { error: string }).error).toMatch(/not linked/i);
    });

    it('404s when the assignment does not exist', async () => {
      setup({ assignment: null });
      expect(await call()).toMatchObject({ ok: false, status: 404, error: 'Assignment not found.' });
    });
  });

  describe('authorization', () => {
    it('forbids a user who is not on the course roster', async () => {
      setup({ enrolled: false });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 403, error: 'Forbidden' });
      expect(auditActions()).toContain('SUBMISSION_FORBIDDEN');
    });

    it('trusts the assignment course, not the client-supplied courseId', async () => {
      setup();
      await call({ courseId: 'attacker-supplied-course' });
      // Authorization must be evaluated against the course the assignment really
      // belongs to; otherwise a caller could name a course they happen to be in.
      expect(canAccessMock).toHaveBeenCalledWith(STUDENT, 'course-1');
    });

    it('hides an unpublished assignment from a student as a 404, not a 403', async () => {
      // A 403 would confirm the assignment exists. Masking is the point.
      setup({ assignment: { ...baseAssignment(), isPublished: false } });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 404, error: 'Assignment not found.' });
      expect(auditActions()).toContain('SUBMISSION_UNPUBLISHED_ASSIGNMENT');
    });

    it('lets staff test-submit an unpublished assignment', async () => {
      setup({ assignment: { ...baseAssignment(), isPublished: false }, staff: true });
      expect(await call()).toMatchObject({ ok: true });
    });

    it('hides an assignment the student is not assigned as a 404', async () => {
      setup({
        assignment: { ...baseAssignment(), assignedToEveryone: false, assignees: [] },
      });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 404, error: 'Assignment not found.' });
      expect(auditActions()).toContain('SUBMISSION_NOT_ASSIGNED');
    });

    it('accepts a student who is individually assigned', async () => {
      setup({
        assignment: {
          ...baseAssignment(),
          assignedToEveryone: false,
          assignees: [{ targetType: 'STUDENT', userId: STUDENT.id, groupId: null }],
        },
      });
      expect(await call()).toMatchObject({ ok: true });
    });

    it('rejects submissions to an archived course even from staff', async () => {
      // Archived is a freeze for everyone, which is easy to regress into "staff bypass".
      setup({ archived: true, staff: true });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 409 });
      expect((res as { error: string }).error).toMatch(/archived/i);
    });
  });

  describe('submission cap', () => {
    it('rejects once the per-problem cap is met', async () => {
      setup({ priorCount: 3 });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 409 });
      expect((res as { error: string }).error).toMatch(/limit reached \(3\)/);
      expect(auditActions()).toContain('SUBMISSION_LIMIT_REACHED');
    });

    it('exempts staff from the cap', async () => {
      setup({ priorCount: 99, staff: true });
      expect(await call()).toMatchObject({ ok: true });
    });

    it('treats maxSubmissions <= 0 as unlimited', async () => {
      setup({
        link: { maxSubmissions: -1, problem: { fileName: 'p.jff', type: 'FA' } },
        priorCount: 500,
      });
      expect(await call()).toMatchObject({ ok: true });
    });

    it('re-checks the cap inside the transaction and rejects a racing submit', async () => {
      // The pre-check passes, but a concurrent submit filled the last slot before this
      // one committed. Without the in-transaction re-check both would be accepted.
      setup({ priorCount: 2, countInTx: 3 });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 409 });
      expect((res as { error: string }).error).toMatch(/limit reached/i);
    });

    it('maps a serialization failure (P2034) to a retryable conflict', async () => {
      setup();
      prismaMock.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('write conflict', {
          code: 'P2034',
          clientVersion: 'test',
        }),
      );
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 409 });
      expect((res as { error: string }).error).toMatch(/concurrent submission conflicted/i);
    });
  });

  describe('cooldown', () => {
    it('rate-limits a resubmit inside the cooldown and reports Retry-After', async () => {
      setup({ cooldownMs: 60_000, lastSubmittedAt: new Date(Date.now() - 10_000) });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 429 });
      // ~50s left; allow a second of slop for clock movement during the test.
      const retry = Number((res as { headers: Record<string, string> }).headers['Retry-After']);
      expect(retry).toBeGreaterThan(45);
      expect(retry).toBeLessThanOrEqual(51);
      expect(auditActions()).toContain('SUBMISSION_RATE_LIMITED');
    });

    it('allows a resubmit once the cooldown has elapsed', async () => {
      setup({ cooldownMs: 60_000, lastSubmittedAt: new Date(Date.now() - 120_000) });
      expect(await call()).toMatchObject({ ok: true });
    });

    it('skips the cooldown check entirely when it is disabled', async () => {
      setup({ cooldownMs: 0, lastSubmittedAt: new Date() });
      expect(await call()).toMatchObject({ ok: true });
      expect(prismaMock.submission.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('availability and late policy', () => {
    it('rejects a student before the assignment unlocks', async () => {
      setup({ assignment: { ...baseAssignment(), unlockAt: future(HOUR) } });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 403 });
      expect((res as { error: string }).error).toMatch(/not open/i);
      expect(auditActions()).toContain('SUBMISSION_REJECTED_NOT_OPEN');
    });

    it('lets staff test-submit before unlock', async () => {
      setup({ assignment: { ...baseAssignment(), unlockAt: future(HOUR) }, staff: true });
      expect(await call()).toMatchObject({ ok: true });
    });

    it('rejects a late submission when late is not allowed', async () => {
      setup({
        assignment: { ...baseAssignment(), dueDate: past(HOUR), allowLateSubmissions: false },
      });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 403 });
      expect(auditActions()).toContain('SUBMISSION_REJECTED_LATE');
    });

    it('accepts a late submission inside the cutoff', async () => {
      setup({
        assignment: {
          ...baseAssignment(),
          dueDate: past(HOUR),
          allowLateSubmissions: true,
          lateCutoff: future(HOUR),
        },
      });
      expect(await call()).toMatchObject({ ok: true });
    });

    it('rejects a late submission past the cutoff', async () => {
      setup({
        assignment: {
          ...baseAssignment(),
          dueDate: past(48 * HOUR),
          allowLateSubmissions: true,
          lateCutoff: past(HOUR),
        },
      });
      const res = await call();
      expect(res).toMatchObject({ ok: false, status: 403 });
      expect(auditActions()).toContain('SUBMISSION_REJECTED_LATE_CUTOFF');
    });

    it('honors a per-student override that extends the deadline past the base due date', async () => {
      // The base assignment is closed; only the override makes this acceptable, so this
      // proves the resolver is actually consulted rather than the base dates.
      setup({
        assignment: {
          ...baseAssignment(),
          dueDate: past(HOUR),
          allowLateSubmissions: false,
          overrides: [
            {
              targetType: 'STUDENT',
              userId: STUDENT.id,
              groupId: null,
              unlockAt: null,
              dueDate: future(HOUR),
              lateCutoff: null,
              allowLateSubmissions: null,
            },
          ],
        },
      });
      expect(await call()).toMatchObject({ ok: true });
    });
  });

  describe('group assignments', () => {
    const groupAssignment = () => ({
      ...baseAssignment(),
      groupSetId: 'gs-1',
      assignedToEveryone: false,
      assignees: [{ targetType: 'GROUP', userId: null, groupId: 'group-9' }],
    });

    it('files the submission against the group and scopes the cap group-wide', async () => {
      const { tx } = setup({ assignment: groupAssignment() });
      const res = await call();

      expect(res).toMatchObject({ ok: true });
      expect(tx.submission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ studentGroupId: 'group-9', studentId: STUDENT.id }),
        }),
      );
      // The cap counts the group's submissions, not just this student's, or each member
      // would get their own full allowance.
      expect(prismaMock.submission.count).toHaveBeenCalledWith({
        where: { assignmentId: 'a-1', problemId: 'p-1', studentGroupId: 'group-9' },
      });
    });

    it('locks the group set as part of the same transaction', async () => {
      setup({ assignment: groupAssignment() });
      await call();
      expect(lockGroupSetMock).toHaveBeenCalledWith(expect.anything(), 'gs-1');
    });

    it('leaves an individual submission ungrouped and student-scoped', async () => {
      const { tx } = setup();
      await call();
      expect(tx.submission.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ studentGroupId: null }) }),
      );
      expect(prismaMock.submission.count).toHaveBeenCalledWith({
        where: { assignmentId: 'a-1', problemId: 'p-1', studentId: STUDENT.id },
      });
    });
  });

  describe('file handling', () => {
    const file = (content = '<structure></structure>', name = 'answer.jff') =>
      new File([content], name, { type: 'text/xml' });

    it('rejects a file over the configured upload limit', async () => {
      setup();
      uploadLimitMock.mockResolvedValue({ maxBytes: 5, maxMb: 0.000005 });
      const res = await call({ file: file('way too much content for five bytes') });
      expect(res).toMatchObject({ ok: false, status: 413 });
      expect(auditActions()).toContain('SUBMISSION_FILE_TOO_LARGE');
    });

    it('rejects a file that fails structure validation', async () => {
      setup();
      validateXmlMock.mockReturnValue({ isValid: false, error: 'Malformed automaton.' });
      const res = await call({ file: file() });
      expect(res).toMatchObject({ ok: false, status: 400, error: 'Malformed automaton.' });
      expect(auditActions()).toContain('SUBMISSION_INVALID_FILE_STRUCTURE');
      // Nothing may be written for a file we rejected.
      expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });

    it('stores an accepted file under a generated name, never the client-supplied one', async () => {
      const { tx } = setup();
      const res = await call({ file: file('<structure></structure>', '../../etc/passwd') });

      expect(res).toMatchObject({ ok: true });
      expect(fsMock.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('stored-uuid.jff'),
        expect.any(Buffer),
        { mode: 0o644 },
      );
      // The original name survives as display metadata only.
      expect(tx.submission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fileName: 'stored-uuid.jff',
            originalFileName: '../../etc/passwd',
          }),
        }),
      );
    });

    it('deletes the stored file when the transaction fails, leaving no orphan', async () => {
      setup();
      prismaMock.$transaction.mockRejectedValue(new Error('db exploded'));
      const res = await call({ file: file() });

      expect(res).toMatchObject({ ok: false, status: 500 });
      expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('stored-uuid.jff'));
      expect(auditActions()).toContain('SUBMISSION_ERROR');
    });

    it('deletes the stored file when the in-transaction cap check rejects', async () => {
      // The cap path returns rather than throws, so it needs its own cleanup and is easy
      // to miss when refactoring.
      setup({ priorCount: 2, countInTx: 3 });
      await call({ file: file() });
      expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('stored-uuid.jff'));
    });

    it('creates no submission row when the file write itself fails', async () => {
      const { tx } = setup();
      fsMock.writeFileSync.mockImplementation(() => {
        throw new Error('disk full');
      });
      const res = await call({ file: file() });

      expect(res).toMatchObject({ ok: false, status: 500 });
      expect(tx.submission.create).not.toHaveBeenCalled();
    });

    it('accepts a submission with no file at all', async () => {
      setup();
      const res = await call({ file: null });
      expect(res).toMatchObject({ ok: true });
      expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('success', () => {
    it('creates a PENDING row and audits the creation', async () => {
      const { created, tx } = setup();
      const res = await call();

      expect(res).toEqual({ ok: true, submission: created });
      expect(tx.submission.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            courseId: 'course-1',
            assignmentId: 'a-1',
            problemId: 'p-1',
            studentId: STUDENT.id,
          }),
        }),
      );
      expect(auditActions()).toContain('SUBMISSION_CREATED');
    });

    it('runs the insert at serializable isolation', async () => {
      setup();
      await call();
      expect(prismaMock.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    });
  });
});

/** The default assignment row, so overriding tests can spread and change one field. */
function baseAssignment() {
  return {
    id: 'a-1',
    courseId: 'course-1',
    unlockAt: null,
    dueDate: future(),
    allowLateSubmissions: false,
    lateCutoff: null,
    isPublished: true,
    assignedToEveryone: true,
    groupSetId: null,
    assignees: [],
    overrides: [],
  };
}

describe('failure after the row is committed', () => {
  it('deletes the file of an already-committed submission when a later audit write fails', async () => {
    const { tx } = setup();
    // The insert succeeds and COMMITS; the audit call after it throws.
    auditMock.mockImplementation(async (_p, _r, opts: { action: string }) => {
      if (opts.action === 'SUBMISSION_CREATED') throw new Error('activity log down');
    });

    const res = await call({ file: new File(['<structure></structure>'], 'a.jff') });

    // The row was created and its transaction committed - it cannot be rolled back here.
    expect(tx.submission.create).toHaveBeenCalledTimes(1);
    // ...but the outer catch treats the whole call as failed and deletes the file.
    expect(fsMock.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('stored-uuid.jff'));
    expect(res).toMatchObject({ ok: false, status: 500 });
  });
});
