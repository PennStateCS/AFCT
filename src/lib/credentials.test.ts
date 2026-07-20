import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Focused coverage for the account-lockout half of verifyCredentials: the durable
 * `lockedUntil` gate and the write that persists a lock when the in-memory limiter
 * trips. The bcrypt/captcha/friction paths are stubbed - this is about lock behaviour.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), updateMany: vi.fn() },
}));
const bcryptMock = vi.hoisted(() => ({ compare: vi.fn() }));
const auditMock = vi.hoisted(() => vi.fn());
const evaluateMock = vi.hoisted(() => vi.fn());
const recordSuccessMock = vi.hoisted(() => vi.fn());
const frictionMock = vi.hoisted(() => vi.fn());
const captchaMock = vi.hoisted(() => vi.fn());
const policyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('bcrypt', () => ({ default: bcryptMock, ...bcryptMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: auditMock }));
vi.mock('@/lib/security/rate-limiter', () => ({
  evaluateLoginRateLimit: evaluateMock,
  recordLoginSuccess: recordSuccessMock,
  applyBotFriction: frictionMock,
}));
vi.mock('@/lib/security/captcha', () => ({ verifyCaptchaToken: captchaMock }));
vi.mock('@/lib/login-policy', () => ({ getLoginLockoutPolicy: policyMock }));

import { verifyCredentials } from './credentials';


const activeUser = (over: Record<string, unknown> = {}) => ({
  id: 'u1',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  isAdmin: false,
  avatar: null,
  temporaryPassword: false,
  lockedUntil: null,
  password: 'hashed',
  ...over,
});

const call = () =>
  verifyCredentials({ email: 'ada@example.com', password: 'pw', ipAddress: '1.2.3.4' });

beforeEach(() => {
  vi.resetAllMocks();
  auditMock.mockResolvedValue(undefined);
  policyMock.mockResolvedValue({ maxAttempts: 10, blockDurationMs: 15 * 60_000 });
  evaluateMock.mockReturnValue({ status: 'ok', applyFriction: false });
  prismaMock.user.findFirst.mockResolvedValue(activeUser());
  prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
  bcryptMock.compare.mockResolvedValue(true);
});

describe('verifyCredentials account lockout', () => {
  it('rejects a locked account before checking the password', async () => {
    prismaMock.user.findFirst.mockResolvedValue(
      activeUser({ lockedUntil: new Date(Date.now() + 10 * 60_000) }),
    );

    const res = await call();

    expect(res).toMatchObject({ ok: false, reason: 'rate_limited' });
    expect((res as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);
    // The decisive assertion: a locked account never reaches bcrypt, so a correct
    // password can't slip past the lock, and timing doesn't leak validity.
    expect(bcryptMock.compare).not.toHaveBeenCalled();
  });

  it('lets a user through once the lock has expired', async () => {
    prismaMock.user.findFirst.mockResolvedValue(
      activeUser({ lockedUntil: new Date(Date.now() - 1000) }),
    );

    const res = await call();

    expect(res).toMatchObject({ ok: true });
    expect(bcryptMock.compare).toHaveBeenCalled();
  });

  it('treats a null lockedUntil as not locked', async () => {
    prismaMock.user.findFirst.mockResolvedValue(activeUser({ lockedUntil: null }));
    expect(await call()).toMatchObject({ ok: true });
  });

  it('persists a lock to the user row when the account limiter blocks', async () => {
    evaluateMock.mockReturnValue({ status: 'blocked', retryAfterMs: 15 * 60_000 });

    const res = await call();

    expect(res).toMatchObject({ ok: false, reason: 'rate_limited' });
    // The write is guarded so only the transition into a lock persists.
    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(1);
    const arg = prismaMock.user.updateMany.mock.calls[0][0];
    expect(arg.where.email).toBe('ada@example.com');
    // Only writes for a user not already locked into the future.
    expect(arg.where.OR).toEqual([
      { lockedUntil: null },
      { lockedUntil: { lte: expect.any(Date) } },
    ]);
    expect(arg.data.lockedUntil.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not fail the login flow if persisting the lock throws', async () => {
    evaluateMock.mockReturnValue({ status: 'blocked', retryAfterMs: 60_000 });
    prismaMock.user.updateMany.mockRejectedValue(new Error('db down'));

    // The persist is fire-and-forget; the caller still gets the rate-limit result.
    const res = await call();
    expect(res).toMatchObject({ ok: false, reason: 'rate_limited' });
  });

  it('does not write a lock on a normal successful login', async () => {
    await call();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('ignores a stale future lock window of zero or negative length', async () => {
    // Defensive: a blocked decision with a non-positive retry must not write a lock.
    evaluateMock.mockReturnValue({ status: 'blocked', retryAfterMs: 0 });
    await call();
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });
});
