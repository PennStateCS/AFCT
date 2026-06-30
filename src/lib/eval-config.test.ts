import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// No SystemSettings row, so the getter falls back to env/defaults — the behavior
// these tests exercise.
const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn().mockResolvedValue(null) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getEvaluatorConfig, getQueueSettings } from './eval-config';

describe('eval-config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    delete process.env.SUBMISSION_EVAL_TIMEOUT_MS;
    delete process.env.SUBMISSION_EVAL_MAX_MEMORY_MB;
    delete process.env.SUBMISSION_RESUBMIT_COOLDOWN_MS;
    delete process.env.SUBMISSION_MAX_CONCURRENT;
    delete process.env.SUBMISSION_MAX_ATTEMPTS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns the defaults when no env vars are set', async () => {
    const config = await getEvaluatorConfig();
    expect(config).toEqual({ timeoutMs: 30_000, maxMemoryMb: 256 });
  });

  it('reads overrides from environment variables', async () => {
    process.env.SUBMISSION_EVAL_TIMEOUT_MS = '45000';
    process.env.SUBMISSION_EVAL_MAX_MEMORY_MB = '512';

    const config = await getEvaluatorConfig();
    expect(config).toEqual({ timeoutMs: 45_000, maxMemoryMb: 512 });
  });

  it('clamps values outside the allowed range', async () => {
    process.env.SUBMISSION_EVAL_TIMEOUT_MS = '999999999'; // above the 10m ceiling
    process.env.SUBMISSION_EVAL_MAX_MEMORY_MB = '1'; // below the 64MB floor

    const config = await getEvaluatorConfig();
    expect(config.timeoutMs).toBe(600_000);
    expect(config.maxMemoryMb).toBe(64);
  });

  it('falls back to defaults for non-numeric values', async () => {
    process.env.SUBMISSION_EVAL_TIMEOUT_MS = 'not-a-number';
    process.env.SUBMISSION_EVAL_MAX_MEMORY_MB = 'abc';

    const config = await getEvaluatorConfig();
    expect(config).toEqual({ timeoutMs: 30_000, maxMemoryMb: 256 });
  });

  describe('getQueueSettings', () => {
    const DEFAULTS = {
      evalTimeoutMs: 30_000,
      evalMaxMemoryMb: 256,
      resubmitCooldownMs: 10_000,
      maxConcurrent: 5,
      maxAttempts: 3,
    };

    it('returns all defaults with no row and no env', async () => {
      prismaMock.systemSettings.findUnique.mockResolvedValue(null);
      expect(await getQueueSettings()).toEqual(DEFAULTS);
    });

    it('reads every value from the SystemSettings row', async () => {
      prismaMock.systemSettings.findUnique.mockResolvedValue({
        submissionEvalTimeoutMs: 45_000,
        submissionEvalMaxMemoryMb: 512,
        submissionResubmitCooldownMs: 5_000,
        submissionMaxConcurrent: 8,
        submissionMaxAttempts: 2,
      });

      expect(await getQueueSettings()).toEqual({
        evalTimeoutMs: 45_000,
        evalMaxMemoryMb: 512,
        resubmitCooldownMs: 5_000,
        maxConcurrent: 8,
        maxAttempts: 2,
      });
    });

    it('prefers the DB row over env vars', async () => {
      process.env.SUBMISSION_EVAL_TIMEOUT_MS = '99000';
      prismaMock.systemSettings.findUnique.mockResolvedValue({
        submissionEvalTimeoutMs: 45_000,
        submissionEvalMaxMemoryMb: 256,
        submissionResubmitCooldownMs: 10_000,
        submissionMaxConcurrent: 5,
        submissionMaxAttempts: 3,
      });

      expect((await getQueueSettings()).evalTimeoutMs).toBe(45_000);
    });

    it('clamps out-of-range DB values', async () => {
      prismaMock.systemSettings.findUnique.mockResolvedValue({
        submissionEvalTimeoutMs: 1, // below 1s floor
        submissionEvalMaxMemoryMb: 999_999, // above 8192 ceiling
        submissionResubmitCooldownMs: -5, // below 0 floor
        submissionMaxConcurrent: 999, // above 20 cap
        submissionMaxAttempts: 99, // above 10 cap
      });

      expect(await getQueueSettings()).toEqual({
        evalTimeoutMs: 1_000,
        evalMaxMemoryMb: 8_192,
        resubmitCooldownMs: 0,
        maxConcurrent: 20,
        maxAttempts: 10,
      });
    });

    it('falls back to env then defaults when the DB is unavailable', async () => {
      process.env.SUBMISSION_MAX_CONCURRENT = '7';
      prismaMock.systemSettings.findUnique.mockRejectedValue(new Error('db down'));

      const settings = await getQueueSettings();
      expect(settings.maxConcurrent).toBe(7); // from env
      expect(settings.maxAttempts).toBe(3); // default
    });
  });
});
