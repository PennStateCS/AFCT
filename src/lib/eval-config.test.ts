import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// No SystemSettings row, so the getter falls back to env/defaults — the behavior
// these tests exercise.
const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn().mockResolvedValue(null) },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getEvaluatorConfig } from './eval-config';

describe('eval-config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    delete process.env.SUBMISSION_EVAL_TIMEOUT_MS;
    delete process.env.SUBMISSION_EVAL_MAX_MEMORY_MB;
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
});
