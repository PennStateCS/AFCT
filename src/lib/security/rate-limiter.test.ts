import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateLoginRateLimit,
  evaluateSignupRateLimit,
  peekLoginRateLimit,
  recordLoginSuccess,
  recordSignupSuccess,
  applyBotFriction,
  formatRetryAfterSeconds,
  evaluateCheckEmailRateLimit,
  sweepExpiredBuckets,
  __dangerousResetRateLimiter,
  __bucketCount,
} from '@/lib/security/rate-limiter';

// The limiter keys off Date.now(); pin it so window/block math is deterministic.
const BASE = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
  __dangerousResetRateLimiter();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('evaluateLoginRateLimit — IP-only escalation', () => {
  const ip = '203.0.113.10';
  const call = () => evaluateLoginRateLimit({ ip });

  it('allows a fresh IP with no friction', () => {
    const decision = call();
    expect(decision).toEqual({ status: 'ok', applyFriction: false, frictionDelayMs: 0 });
  });

  it('applies friction once the IP crosses the friction threshold (8th attempt)', () => {
    // Attempts 1–7 stay clean, the 8th trips friction.
    for (let i = 1; i <= 7; i++) {
      expect((call() as unknown as { applyFriction: boolean }).applyFriction).toBe(false);
    }
    const eighth = call();
    expect(eighth.status).toBe('ok');
    expect(eighth).toMatchObject({ status: 'ok', applyFriction: true });
    if (eighth.status === 'ok') expect(eighth.frictionDelayMs).toBeGreaterThan(0);
  });

  it('escalates to a challenge at the challenge threshold (14th attempt)', () => {
    let decision = call();
    for (let i = 2; i <= 14; i++) decision = call();
    expect(decision.status).toBe('challenge');
    if (decision.status === 'challenge') {
      expect(decision.reason).toBe('ip');
      expect(decision.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('keeps returning challenge within the cooldown without further increments', () => {
    let decision = call();
    for (let i = 2; i <= 14; i++) decision = call();
    expect(decision.status).toBe('challenge');
    // Immediately re-calling stays a challenge (no count bump toward a block).
    const next = call();
    expect(next.status).toBe('challenge');
  });
});

describe('evaluateLoginRateLimit — account lockout policy', () => {
  it('blocks the account after the configured max attempts, reason "account"', () => {
    const params = {
      ip: '203.0.113.20',
      identifier: 'user@example.com',
      accountLimit: { maxAttempts: 1 },
    };
    // First attempt is allowed, second exceeds the 1-attempt cap → blocked.
    expect(evaluateLoginRateLimit(params).status).toBe('ok');
    const blocked = evaluateLoginRateLimit(params);
    expect(blocked.status).toBe('blocked');
    if (blocked.status === 'blocked') {
      expect(blocked.reason).toBe('account');
      expect(blocked.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('honors a custom block duration and counts it down as time passes', () => {
    const params = {
      ip: '203.0.113.21',
      identifier: 'lock@example.com',
      accountLimit: { maxAttempts: 1, blockDurationMs: 60_000 },
    };
    evaluateLoginRateLimit(params);
    const blocked = evaluateLoginRateLimit(params);
    expect(blocked.status).toBe('blocked');
    const initialRetry = blocked.status === 'blocked' ? blocked.retryAfterMs : 0;
    expect(initialRetry).toBeLessThanOrEqual(60_000);

    vi.advanceTimersByTime(30_000);
    const stillBlocked = evaluateLoginRateLimit(params);
    expect(stillBlocked.status).toBe('blocked');
    if (stillBlocked.status === 'blocked') {
      expect(stillBlocked.retryAfterMs).toBeLessThan(initialRetry);
    }
  });

  it('lets the account through again once the block window elapses', () => {
    const params = {
      ip: '203.0.113.22',
      identifier: 'expire@example.com',
      accountLimit: { maxAttempts: 1, blockDurationMs: 60_000 },
    };
    evaluateLoginRateLimit(params);
    expect(evaluateLoginRateLimit(params).status).toBe('blocked');

    // Advance past both the block window and the (longer) rate window so buckets reset.
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(evaluateLoginRateLimit(params).status).toBe('ok');
  });
});

describe('recordLoginSuccess', () => {
  it('clears both the IP and account buckets so the next evaluation is fresh', () => {
    const ip = '203.0.113.30';
    const identifier = 'success@example.com';
    for (let i = 0; i < 9; i++) evaluateLoginRateLimit({ ip, identifier });
    // Both buckets are warm. A successful login should wipe IP + account keys.
    recordLoginSuccess({ ip, identifier });
    expect(evaluateLoginRateLimit({ ip, identifier })).toEqual({
      status: 'ok',
      applyFriction: false,
      frictionDelayMs: 0,
    });
  });
});

describe('interaction timing friction', () => {
  it('adds friction when the form was submitted implausibly fast', () => {
    const decision = evaluateLoginRateLimit({ ip: '203.0.113.40', interactionMs: 100 });
    expect(decision.status).toBe('ok');
    if (decision.status === 'ok') {
      expect(decision.applyFriction).toBe(true);
      expect(decision.frictionDelayMs).toBeGreaterThanOrEqual(250);
      expect(decision.frictionDelayMs).toBeLessThanOrEqual(1200);
    }
  });

  it('does not add friction for a human-paced submission', () => {
    const decision = evaluateLoginRateLimit({ ip: '203.0.113.41', interactionMs: 5_000 });
    expect(decision).toEqual({ status: 'ok', applyFriction: false, frictionDelayMs: 0 });
  });
});

describe('evaluateSignupRateLimit', () => {
  it('challenges at the per-identifier cap, then blocks a further attempt after cooldown', () => {
    const params = { ip: '203.0.113.50', identifier: 'newuser@example.com' };
    // SIGNUP_IDENTIFIER_CONFIG: friction@2, challenge@3, max@3.
    expect(evaluateSignupRateLimit(params).status).toBe('ok'); // 1
    evaluateSignupRateLimit(params); // 2 (friction)
    const third = evaluateSignupRateLimit(params); // 3 → challenge, freezes increments
    expect(third.status).toBe('challenge');
    if (third.status === 'challenge') expect(third.reason).toBe('account');

    // Wait out the challenge cooldown; the next attempt pushes past the cap → blocked.
    vi.advanceTimersByTime(10 * 60 * 1000 + 1_000);
    const blocked = evaluateSignupRateLimit(params);
    expect(blocked.status).toBe('blocked');
    if (blocked.status === 'blocked') expect(blocked.reason).toBe('account');
  });

  it('recordSignupSuccess resets the counters', () => {
    const params = { ip: '203.0.113.51', identifier: 'reset@example.com' };
    evaluateSignupRateLimit(params);
    evaluateSignupRateLimit(params);
    recordSignupSuccess(params);
    expect(evaluateSignupRateLimit(params).status).toBe('ok');
  });
});

describe('applyBotFriction', () => {
  it('resolves immediately for a non-positive delay', async () => {
    await expect(applyBotFriction(0)).resolves.toBeUndefined();
    await expect(applyBotFriction()).resolves.toBeUndefined();
  });

  it('waits out a positive delay', async () => {
    const pending = applyBotFriction(100);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    // Delay is 100ms + random(50,200); flush all pending timers.
    await vi.runAllTimersAsync();
    await pending;
    expect(settled).toBe(true);
  });
});

describe('formatRetryAfterSeconds', () => {
  it('rounds up to whole seconds with a floor of 1', () => {
    expect(formatRetryAfterSeconds(0)).toBe('1');
    expect(formatRetryAfterSeconds(1)).toBe('1');
    expect(formatRetryAfterSeconds(1_000)).toBe('1');
    expect(formatRetryAfterSeconds(1_001)).toBe('2');
    expect(formatRetryAfterSeconds(2_500)).toBe('3');
  });
});

describe('peekLoginRateLimit — read-only classification', () => {
  const ip = '198.51.100.7';
  const identifier = 'user@example.edu';

  it('reports ok for a fresh IP/account and does not count', () => {
    expect(peekLoginRateLimit({ ip, identifier }).status).toBe('ok');
    // Peeking many times never escalates on its own.
    for (let i = 0; i < 30; i++) peekLoginRateLimit({ ip, identifier });
    expect(peekLoginRateLimit({ ip, identifier }).status).toBe('ok');
    // A real evaluation right after is still the FIRST counted attempt (ok).
    expect(evaluateLoginRateLimit({ ip, identifier }).status).toBe('ok');
  });

  it('reports challenge once the account bucket has been challenged', () => {
    // Drive the per-account bucket to its challenge threshold (7).
    for (let i = 1; i <= 7; i++) evaluateLoginRateLimit({ ip, identifier });
    expect(evaluateLoginRateLimit({ ip, identifier }).status).toBe('challenge');
    // The peek reflects that state without advancing toward a block.
    expect(peekLoginRateLimit({ ip, identifier }).status).toBe('challenge');
    expect(peekLoginRateLimit({ ip, identifier }).status).toBe('challenge');
  });

  it('reports blocked once the bucket is blocked', () => {
    // A tight per-account cap trips a block on the 2nd attempt (before the challenge
    // threshold), which the peek then reflects.
    const accountLimit = { maxAttempts: 1 };
    evaluateLoginRateLimit({ ip, identifier, accountLimit });
    expect(evaluateLoginRateLimit({ ip, identifier, accountLimit }).status).toBe('blocked');
    expect(peekLoginRateLimit({ ip, identifier, accountLimit }).status).toBe('blocked');
  });
});

describe('sweepExpiredBuckets — memory hygiene', () => {
  it('drops a bucket once its window has fully elapsed', () => {
    evaluateLoginRateLimit({ ip: '203.0.113.7' }); // creates a login:ip bucket
    // Window (10 min) still open: nothing to reap.
    expect(sweepExpiredBuckets(BASE)).toBe(0);
    // Past the window with no block/challenge outstanding: the stale bucket is reaped.
    expect(sweepExpiredBuckets(BASE + 10 * 60 * 1000 + 1)).toBe(1);
    // Nothing left on a second pass.
    expect(sweepExpiredBuckets(BASE + 10 * 60 * 1000 + 1)).toBe(0);
  });

  it('keeps a bucket that is still inside its block window, reaps it after', () => {
    // check-email disables friction/challenge, so it blocks cleanly and leaves exactly one
    // bucket. Config: 10-min window, max 30, 15-min block.
    const ip = '203.0.113.8';
    for (let i = 0; i < 31; i++) evaluateCheckEmailRateLimit({ ip });
    expect(evaluateCheckEmailRateLimit({ ip }).status).toBe('blocked');
    // Window (10 min) has passed but the 15-min block has not: must NOT reap (else the
    // blocked client would reset early).
    expect(sweepExpiredBuckets(BASE + 12 * 60 * 1000)).toBe(0);
    // Once the block elapses the bucket carries no live state and is safe to drop.
    expect(sweepExpiredBuckets(BASE + 16 * 60 * 1000)).toBe(1);
  });

  it('caps the map under a flood of unique keys (all still inside their window)', () => {
    // 60k unique IPs, all at the same instant, so none are expired: the time-based sweep
    // cannot touch them. The hard cap must still bound the map (would be 60k without it).
    for (let i = 0; i < 60_000; i++) {
      evaluateCheckEmailRateLimit({ ip: `10.0.${(i >> 8) & 255}.${i & 255}` });
    }
    // Cap is 50k; the map stayed bounded well below the 60k unique keys seen.
    expect(__bucketCount()).toBeLessThanOrEqual(50_001);
    expect(__bucketCount()).toBeGreaterThan(10_000); // still retains a large recent working set
  });
});
