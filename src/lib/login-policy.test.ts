import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getLoginLockoutPolicy } from './login-policy';

describe('getLoginLockoutPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LOGIN_MAX_ATTEMPTS;
    delete process.env.LOGIN_LOCKOUT_MINUTES;
  });

  afterEach(() => {
    delete process.env.LOGIN_MAX_ATTEMPTS;
    delete process.env.LOGIN_LOCKOUT_MINUTES;
  });

  it('uses built-in defaults when there is no DB row or env', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    const policy = await getLoginLockoutPolicy();

    expect(policy).toEqual({ maxAttempts: 10, blockDurationMs: 10 * 60_000 });
  });

  it('falls back to env vars when the DB row is missing', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);
    process.env.LOGIN_MAX_ATTEMPTS = '6';
    process.env.LOGIN_LOCKOUT_MINUTES = '20';

    const policy = await getLoginLockoutPolicy();

    expect(policy).toEqual({ maxAttempts: 6, blockDurationMs: 20 * 60_000 });
  });

  it('prefers the DB value over env', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      loginMaxAttempts: 8,
      loginLockoutMinutes: 30,
    });
    process.env.LOGIN_MAX_ATTEMPTS = '6';
    process.env.LOGIN_LOCKOUT_MINUTES = '20';

    const policy = await getLoginLockoutPolicy();

    expect(policy).toEqual({ maxAttempts: 8, blockDurationMs: 30 * 60_000 });
  });

  it('clamps out-of-range values to safe bounds', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({
      loginMaxAttempts: 9999, // above the 50 ceiling
      loginLockoutMinutes: 0, // below the 1-minute floor
    });

    const policy = await getLoginLockoutPolicy();

    expect(policy).toEqual({ maxAttempts: 50, blockDurationMs: 1 * 60_000 });
  });

  it('falls back to defaults when the DB read throws', async () => {
    prismaMock.systemSettings.findUnique.mockRejectedValue(new Error('db down'));

    const policy = await getLoginLockoutPolicy();

    expect(policy).toEqual({ maxAttempts: 10, blockDurationMs: 10 * 60_000 });
  });
});
