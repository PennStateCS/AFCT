import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  evaluatorTrial: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
}));
const unlinkMock = vi.hoisted(() => vi.fn());
const readdirMock = vi.hoisted(() => vi.fn());
const statMock = vi.hoisted(() => vi.fn());
const fsUnlinkMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('fs/promises', () => ({ unlink: unlinkMock, default: { unlink: unlinkMock } }));
vi.mock('fs', () => {
  const api = { promises: { readdir: readdirMock, stat: statMock, unlink: fsUnlinkMock } };
  return { default: api, ...api };
});

import {
  trialConcurrencyLimit,
  trialExpiresAt,
  deleteTrialInputs,
  pruneExpiredTrials,
  sweepOrphanTrialFiles,
  TRIAL_RESULT_TTL_MS,
} from './evaluator-trials';

const NOW = new Date('2026-08-14T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.evaluatorTrial.findMany.mockResolvedValue([]);
  prismaMock.evaluatorTrial.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.evaluatorTrial.deleteMany.mockResolvedValue({ count: 0 });
});

describe('trialConcurrencyLimit', () => {
  it('leaves a loop free for grading once there is more than one', () => {
    expect(trialConcurrencyLimit(5)).toBe(2);
    expect(trialConcurrencyLimit(3)).toBe(2);
    expect(trialConcurrencyLimit(2)).toBe(1);
  });

  it('still allows one trial when there is a single loop, or trials would never run', () => {
    expect(trialConcurrencyLimit(1)).toBe(1);
  });
});

describe('trialExpiresAt', () => {
  it('is an hour out', () => {
    expect(trialExpiresAt(NOW).getTime()).toBe(NOW.getTime() + TRIAL_RESULT_TTL_MS);
  });
});

describe('deleteTrialInputs', () => {
  it('removes both files and forgets their names', async () => {
    await deleteTrialInputs({ id: 't1', answerFileName: 'a.jff', submissionFileName: 's.jff' });

    expect(unlinkMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.evaluatorTrial.updateMany).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { answerFileName: null, submissionFileName: null },
    });
  });

  it('does nothing at all once the names are gone', async () => {
    await deleteTrialInputs({ id: 't1', answerFileName: null, submissionFileName: null });

    expect(unlinkMock).not.toHaveBeenCalled();
    expect(prismaMock.evaluatorTrial.updateMany).not.toHaveBeenCalled();
  });
});

describe('pruneExpiredTrials', () => {
  it('takes the uploads before the rows', async () => {
    prismaMock.evaluatorTrial.findMany.mockResolvedValue([
      { id: 't1', answerFileName: 'a.jff', submissionFileName: 's.jff' },
    ]);
    prismaMock.evaluatorTrial.deleteMany.mockResolvedValue({ count: 1 });

    expect(await pruneExpiredTrials(NOW)).toBe(1);
    expect(unlinkMock).toHaveBeenCalledTimes(2);
    expect(prismaMock.evaluatorTrial.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lt: NOW } },
    });
  });
});

describe('sweepOrphanTrialFiles', () => {
  const old = { mtimeMs: NOW.getTime() - 60 * 60 * 1000 };

  it('removes a file no row claims', async () => {
    readdirMock.mockResolvedValue(['orphan.jff']);
    statMock.mockResolvedValue(old);

    expect(await sweepOrphanTrialFiles(NOW)).toBe(1);
    expect(fsUnlinkMock).toHaveBeenCalledTimes(1);
  });

  it('leaves a file a trial still points at', async () => {
    readdirMock.mockResolvedValue(['kept.jff']);
    statMock.mockResolvedValue(old);
    prismaMock.evaluatorTrial.findMany.mockResolvedValue([
      { answerFileName: 'kept.jff', submissionFileName: null },
    ]);

    expect(await sweepOrphanTrialFiles(NOW)).toBe(0);
    expect(fsUnlinkMock).not.toHaveBeenCalled();
  });

  it('leaves a file that is still waiting for its row to be written', async () => {
    readdirMock.mockResolvedValue(['fresh.jff']);
    statMock.mockResolvedValue({ mtimeMs: NOW.getTime() - 1000 });

    expect(await sweepOrphanTrialFiles(NOW)).toBe(0);
    expect(fsUnlinkMock).not.toHaveBeenCalled();
  });

  it('is quiet when nothing has ever been uploaded', async () => {
    readdirMock.mockRejectedValue(new Error('ENOENT'));

    expect(await sweepOrphanTrialFiles(NOW)).toBe(0);
    expect(prismaMock.evaluatorTrial.findMany).not.toHaveBeenCalled();
  });
});
