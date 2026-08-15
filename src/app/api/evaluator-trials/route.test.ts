import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  evaluatorTrial: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const uploadLimitMock = vi.hoisted(() => vi.fn());
const validateMock = vi.hoisted(() => vi.fn());
const mkdirMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
const unlinkMock = vi.hoisted(() => vi.fn());
const readdirMock = vi.hoisted(() => vi.fn());
const statMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/upload-limits', () => ({ getSystemUploadLimit: uploadLimitMock }));
vi.mock('@/app/utils/xmlStructureValidate', () => ({ validateStructureXML: validateMock }));
vi.mock('fs', () => {
  const api = {
    promises: {
      mkdir: mkdirMock,
      writeFile: writeFileMock,
      unlink: unlinkMock,
      readdir: readdirMock,
      stat: statMock,
    },
  };
  return { default: api, ...api };
});
vi.mock('fs/promises', () => ({ unlink: unlinkMock, default: { unlink: unlinkMock } }));

import { POST } from './route';

const STAFF = { user: { id: 'fac-1', isAdmin: false } };

const submit = (
  fields: Record<string, string> = {},
  files: { answer?: { name: string; body: string } | null; submission?: { name: string; body: string } | null } = {},
) => {
  const answer = files.answer === undefined ? { name: 'answer.jff', body: '<structure/>' } : files.answer;
  const submission =
    files.submission === undefined ? { name: 'student.jff', body: '<structure/>' } : files.submission;
  const form = new FormData();
  form.set('type', 'FA');
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (answer) form.set('answerFile', new File([answer.body], answer.name, { type: 'text/xml' }));
  if (submission) {
    form.set('submissionFile', new File([submission.body], submission.name, { type: 'text/xml' }));
  }
  return POST(new Request('http://localhost/api/evaluator-trials', { method: 'POST', body: form }), {});
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue(STAFF);
  // Staff of some course: what withStaffAuth looks for.
  prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1' });
  prismaMock.evaluatorTrial.findFirst.mockResolvedValue(null);
  prismaMock.evaluatorTrial.findMany.mockResolvedValue([]);
  prismaMock.evaluatorTrial.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.evaluatorTrial.create.mockImplementation(async ({ data }: { data: object }) => ({
    id: 'trial-1',
    state: 'PENDING',
    correct: null,
    feedback: null,
    evaluationRaw: null,
    stderr: null,
    durationMs: null,
    createdAt: new Date('2026-08-14T12:00:00Z'),
    startedAt: null,
    completedAt: null,
    expiresAt: new Date('2026-08-14T13:00:00Z'),
    ...data,
  }));
  uploadLimitMock.mockResolvedValue({ maxBytes: 5 * 1024 * 1024, maxMb: 5 });
  validateMock.mockReturnValue({ isValid: true });
  readdirMock.mockResolvedValue([]);
});

describe('POST /api/evaluator-trials', () => {
  it('queues a trial and answers with what the page needs to poll', async () => {
    const res = await submit({ maxStates: '5', isDeterministic: 'true' });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: 'trial-1',
      state: 'PENDING',
      answerFile: 'answer.jff',
      submissionFile: 'student.jff',
    });
    expect(prismaMock.evaluatorTrial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestedById: 'fac-1',
          problemType: 'FA',
          maxStates: 5,
          isDeterministic: true,
        }),
      }),
    );
  });

  it('records who ran what, with the file names the uploads no longer keep', async () => {
    await submit();

    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        userId: 'fac-1',
        action: 'EVALUATOR_TRIAL_STARTED',
        severity: 'INFO',
        // SYSTEM, not SUBMISSION: the study reads SUBMISSION events as student activity.
        category: 'SYSTEM',
        metadata: expect.objectContaining({
          trialId: 'trial-1',
          problemType: 'FA',
          answerFileName: 'answer.jff',
          submissionFileName: 'student.jff',
        }),
      }),
    );
  });

  it('records a file the evaluator could not read', async () => {
    validateMock.mockReturnValue({ isValid: false, error: 'not an automaton' });

    await submit();

    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'EVALUATOR_TRIAL_INVALID_FILE', severity: 'WARNING' }),
    );
  });

  it('drops the state bound and determinism flag for a type that has neither', async () => {
    await submit({ type: 'CFG', maxStates: '5', isDeterministic: 'true' });

    expect(prismaMock.evaluatorTrial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ maxStates: null, isDeterministic: null }),
      }),
    );
  });

  it('never writes to a path built from an uploaded name', async () => {
    await submit({}, { answer: { name: '../../../../etc/passwd.jff', body: '<structure/>' } });

    expect(writeFileMock).toHaveBeenCalledTimes(2);
    const [written] = writeFileMock.mock.calls[0] as [string];
    expect(written).not.toContain('passwd');
    expect(written).not.toContain('..');
    expect(written).toMatch(/[0-9a-f-]{36}\.jff$/);
    expect(prismaMock.evaluatorTrial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ answerOriginalName: '../../../../etc/passwd.jff' }),
      }),
    );
  });

  it('refuses a second trial while one is still in flight, before writing anything', async () => {
    prismaMock.evaluatorTrial.findFirst.mockResolvedValue({ id: 'trial-0' });

    const res = await submit();

    expect(res.status).toBe(409);
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(prismaMock.evaluatorTrial.create).not.toHaveBeenCalled();
  });

  it('requires both files', async () => {
    const res = await submit({}, { submission: null });

    expect(res.status).toBe(400);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('rejects a file type the evaluator does not take', async () => {
    const res = await submit({}, { submission: { name: 'notes.pdf', body: 'x' } });

    expect(res.status).toBe(400);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('enforces the configured upload limit, not a constant', async () => {
    uploadLimitMock.mockResolvedValue({ maxBytes: 4, maxMb: 0.000004 });

    const res = await submit();

    expect(res.status).toBe(413);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('rejects a file that fails structure validation, saying which one', async () => {
    validateMock.mockReturnValueOnce({ isValid: true }).mockReturnValueOnce({
      isValid: false,
      error: 'not an automaton',
    });

    const res = await submit();

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('submission file');
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('removes both uploads when the row cannot be created', async () => {
    prismaMock.evaluatorTrial.create.mockRejectedValue(new Error('db down'));

    const res = await submit();

    expect(res.status).toBe(500);
    expect(unlinkMock).toHaveBeenCalledTimes(2);
  });

  it('keeps students out and records the refusal', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu-1', isAdmin: false } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    const res = await submit();

    expect(res.status).toBe(403);
    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({ action: 'EVALUATOR_TRIAL_ACCESS_DENIED', severity: 'SECURITY' }),
    );
    expect(prismaMock.evaluatorTrial.create).not.toHaveBeenCalled();
  });

  it('turns an unsigned request away without a log', async () => {
    authMock.mockResolvedValue(null);

    const res = await submit();

    expect(res.status).toBe(401);
    expect(activityLogMock).not.toHaveBeenCalled();
  });
});
