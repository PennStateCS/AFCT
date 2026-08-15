import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  roster: { findFirst: vi.fn() },
  evaluatorTrial: { findUnique: vi.fn(), updateMany: vi.fn(), delete: vi.fn() },
}));

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const unlinkMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs/promises', () => ({ unlink: unlinkMock, default: { unlink: unlinkMock } }));

import { GET, DELETE } from './route';

const ctx = { params: Promise.resolve({ id: 'trial-1' }) };
const get = () => GET(new Request('http://localhost/api/evaluator-trials/trial-1'), ctx);
const del = () =>
  DELETE(new Request('http://localhost/api/evaluator-trials/trial-1', { method: 'DELETE' }), ctx);

const trial = (over: Record<string, unknown> = {}) => ({
  id: 'trial-1',
  requestedById: 'fac-1',
  state: 'PENDING',
  problemType: 'FA',
  maxStates: 5,
  isDeterministic: true,
  answerFileName: 'stored-answer.jff',
  submissionFileName: 'stored-submission.jff',
  answerOriginalName: 'answer.jff',
  submissionOriginalName: 'student.jff',
  correct: null,
  feedback: null,
  evaluationRaw: null,
  stderr: null,
  durationMs: null,
  createdAt: new Date('2026-08-14T12:00:00Z'),
  startedAt: null,
  completedAt: null,
  expiresAt: new Date('2026-08-14T13:00:00Z'),
  updatedAt: new Date('2026-08-14T12:00:00Z'),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'fac-1', isAdmin: false } });
  prismaMock.roster.findFirst.mockResolvedValue({ id: 'r1' });
  prismaMock.evaluatorTrial.findUnique.mockResolvedValue(trial());
  prismaMock.evaluatorTrial.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.evaluatorTrial.delete.mockResolvedValue(trial());
});

describe('GET /api/evaluator-trials/[id]', () => {
  it('reports a run still in progress without touching the uploads', async () => {
    prismaMock.evaluatorTrial.findUnique.mockResolvedValue(trial({ state: 'PROCESSING' }));

    const res = await get();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: 'PROCESSING', answerFile: 'answer.jff' });
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('returns the verdict and deletes the uploads once the run is over', async () => {
    prismaMock.evaluatorTrial.findUnique.mockResolvedValue(
      trial({
        state: 'COMPLETED',
        correct: true,
        feedback: 'Accepted',
        evaluationRaw: { correct: true },
        durationMs: 812,
        completedAt: new Date('2026-08-14T12:00:09Z'),
      }),
    );

    const res = await get();

    expect(await res.json()).toMatchObject({
      state: 'COMPLETED',
      correct: true,
      feedback: 'Accepted',
      evaluationRaw: { correct: true },
      durationMs: 812,
    });
    // Both uploads, then the row forgets their names so nothing tries again.
    expect(unlinkMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.evaluatorTrial.updateMany).toHaveBeenCalledWith({
      where: { id: 'trial-1' },
      data: { answerFileName: null, submissionFileName: null },
    });
  });

  it('never exposes the stored file names, only the ones the uploader chose', async () => {
    prismaMock.evaluatorTrial.findUnique.mockResolvedValue(trial({ state: 'COMPLETED' }));

    const body = await (await get()).json();

    expect(JSON.stringify(body)).not.toContain('stored-answer.jff');
  });

  it('masks somebody else’s trial as missing', async () => {
    prismaMock.evaluatorTrial.findUnique.mockResolvedValue(trial({ requestedById: 'fac-2' }));

    expect((await get()).status).toBe(404);
  });

  it('lets an admin read any trial', async () => {
    authMock.mockResolvedValue({ user: { id: 'admin', isAdmin: true } });
    prismaMock.evaluatorTrial.findUnique.mockResolvedValue(trial({ requestedById: 'fac-2' }));

    expect((await get()).status).toBe(200);
  });
});

describe('DELETE /api/evaluator-trials/[id]', () => {
  it('removes the uploads and the row', async () => {
    const res = await del();

    expect(res.status).toBe(204);
    expect(unlinkMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.evaluatorTrial.delete).toHaveBeenCalledWith({ where: { id: 'trial-1' } });
  });

  it('records the discard, since nothing survives it', async () => {
    await del();

    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        userId: 'fac-1',
        action: 'EVALUATOR_TRIAL_DISCARDED',
        category: 'SYSTEM',
        metadata: expect.objectContaining({ trialId: 'trial-1' }),
      }),
    );
  });

  it('will not discard somebody else’s trial', async () => {
    prismaMock.evaluatorTrial.findUnique.mockResolvedValue(trial({ requestedById: 'fac-2' }));

    expect((await del()).status).toBe(404);
    expect(prismaMock.evaluatorTrial.delete).not.toHaveBeenCalled();
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it('keeps students out', async () => {
    authMock.mockResolvedValue({ user: { id: 'stu-1', isAdmin: false } });
    prismaMock.roster.findFirst.mockResolvedValue(null);

    expect((await del()).status).toBe(403);
    expect(prismaMock.evaluatorTrial.delete).not.toHaveBeenCalled();
  });
});
