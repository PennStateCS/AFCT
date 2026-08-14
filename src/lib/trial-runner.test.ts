import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  evaluatorTrial: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const runEvaluatorJarMock = vi.hoisted(() => vi.fn());
const getEvaluatorConfigMock = vi.hoisted(() => vi.fn());
const existsSyncMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('./evaluator-runner', () => ({ runEvaluatorJar: runEvaluatorJarMock }));
vi.mock('./eval-config', () => ({ getEvaluatorConfig: getEvaluatorConfigMock }));
vi.mock('fs', () => ({ default: { existsSync: existsSyncMock }, existsSync: existsSyncMock }));

import { claimAndRunTrial, reapStuckTrials } from './trial-runner';

const TRIAL = {
  answerFileName: 'a.jff',
  submissionFileName: 's.jff',
  problemType: 'FA' as const,
  maxStates: 5,
  isDeterministic: true,
};

/** The single update that records an outcome (the claim is asserted separately). */
const finishData = (): Record<string, unknown> => {
  const last = prismaMock.evaluatorTrial.updateMany.mock.calls.at(-1) as [
    { where: unknown; data: Record<string, unknown> },
  ];
  return last[0].data;
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.evaluatorTrial.findFirst.mockResolvedValue({ id: 'trial-1' });
  prismaMock.evaluatorTrial.count.mockResolvedValue(0);
  prismaMock.evaluatorTrial.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.evaluatorTrial.findUnique.mockResolvedValue(TRIAL);
  getEvaluatorConfigMock.mockResolvedValue({ timeoutMs: 5000, maxMemoryMb: 256, analyzerLimit: 100 });
  existsSyncMock.mockReturnValue(true);
  runEvaluatorJarMock.mockResolvedValue({
    outcome: 'ok',
    evaluation: { correct: true, feedback: 'Accepted' },
    correct: true,
    feedback: 'Accepted',
    stdout: '{"correct":true}',
    stderr: '',
    durationMs: 900,
  });
});

describe('claimAndRunTrial', () => {
  it('does nothing, and costs one query, when no trial is waiting', async () => {
    prismaMock.evaluatorTrial.findFirst.mockResolvedValue(null);

    expect(await claimAndRunTrial(5)).toBe(false);
    expect(prismaMock.evaluatorTrial.count).not.toHaveBeenCalled();
    expect(runEvaluatorJarMock).not.toHaveBeenCalled();
  });

  it('claims on the PENDING guard, so a lost race runs nothing', async () => {
    prismaMock.evaluatorTrial.updateMany.mockResolvedValue({ count: 0 });

    expect(await claimAndRunTrial(5)).toBe(false);
    expect(prismaMock.evaluatorTrial.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'trial-1', state: 'PENDING' } }),
    );
    expect(runEvaluatorJarMock).not.toHaveBeenCalled();
  });

  it('leaves a trial waiting rather than filling the last worker slots', async () => {
    prismaMock.evaluatorTrial.count.mockResolvedValue(2);

    expect(await claimAndRunTrial(5)).toBe(false);
    expect(runEvaluatorJarMock).not.toHaveBeenCalled();
  });

  it('still runs one when there is only a single worker loop', async () => {
    expect(await claimAndRunTrial(1)).toBe(true);
    expect(runEvaluatorJarMock).toHaveBeenCalled();
  });

  it('passes the trial’s own problem settings to the evaluator', async () => {
    await claimAndRunTrial(5);

    expect(runEvaluatorJarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        problem: { type: 'FA', maxStates: 5, isDeterministic: true },
      }),
    );
  });

  it('records a verdict, and fences the write on still holding the claim', async () => {
    await claimAndRunTrial(5);

    const [{ where, data }] = prismaMock.evaluatorTrial.updateMany.mock.calls.at(-1) as [
      { where: Record<string, unknown>; data: Record<string, unknown> },
    ];
    expect(where).toEqual({ id: 'trial-1', state: 'PROCESSING' });
    expect(data).toMatchObject({
      state: 'COMPLETED',
      correct: true,
      feedback: 'Accepted',
      durationMs: 900,
    });
  });

  it('fails the trial, keeping the raw output, when the evaluator returns no result', async () => {
    runEvaluatorJarMock.mockResolvedValue({
      outcome: 'unparsable',
      parseError: 'Unexpected token',
      stdout: 'Exception in thread "main"',
      stderr: 'boom',
      durationMs: 40,
    });

    await claimAndRunTrial(5);

    expect(finishData()).toMatchObject({
      state: 'FAILED',
      evaluationRaw: 'Exception in thread "main"',
      stderr: 'boom',
    });
  });

  it('fails the trial when the jar could not run at all', async () => {
    runEvaluatorJarMock.mockResolvedValue({
      outcome: 'error',
      error: 'Evaluation timed out',
      stdout: '',
      stderr: '',
      durationMs: 5000,
    });

    await claimAndRunTrial(5);

    expect(finishData()).toMatchObject({ state: 'FAILED' });
    expect(String(finishData().feedback)).toContain('Evaluation timed out');
  });

  it('fails the trial when its uploads have already been swept', async () => {
    existsSyncMock.mockReturnValue(false);

    await claimAndRunTrial(5);

    expect(runEvaluatorJarMock).not.toHaveBeenCalled();
    expect(String(finishData().feedback)).toContain('no longer available');
  });
});

describe('reapStuckTrials', () => {
  it('fails a trial left running rather than queueing it again', async () => {
    prismaMock.evaluatorTrial.updateMany.mockResolvedValue({ count: 2 });

    const cutoff = new Date('2026-08-14T12:00:00Z');
    expect(await reapStuckTrials(cutoff)).toBe(2);
    expect(prismaMock.evaluatorTrial.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { state: 'PROCESSING', startedAt: { lt: cutoff } },
        data: expect.objectContaining({ state: 'FAILED' }),
      }),
    );
  });
});
