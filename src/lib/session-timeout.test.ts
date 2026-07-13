import { describe, expect, it } from 'vitest';
import {
  sessionTimeoutMs,
  computeWarningLeadMs,
  computeHeartbeatIntervalMs,
  computeServerIdleGraceMs,
  serverIdleTimeoutMs,
  isSessionIdleExpired,
} from './session-timeout';

describe('sessionTimeoutMs', () => {
  it('converts minutes to ms', () => {
    expect(sessionTimeoutMs(20)).toBe(20 * 60_000);
    expect(sessionTimeoutMs(5)).toBe(300_000);
  });
  it('floors fractional minutes', () => {
    expect(sessionTimeoutMs(5.9)).toBe(5 * 60_000);
  });
  it('returns 0 for non-finite or non-positive input', () => {
    expect(sessionTimeoutMs(0)).toBe(0);
    expect(sessionTimeoutMs(-3)).toBe(0);
    expect(sessionTimeoutMs(NaN)).toBe(0);
  });
});

describe('computeWarningLeadMs', () => {
  it('is a flat 60s for normal windows', () => {
    expect(computeWarningLeadMs(20 * 60_000)).toBe(60_000);
  });
  it('never exceeds half the window', () => {
    expect(computeWarningLeadMs(60_000)).toBe(30_000);
  });
});

describe('computeHeartbeatIntervalMs', () => {
  it('is a quarter of the window, clamped to [1min, 10min]', () => {
    expect(computeHeartbeatIntervalMs(20 * 60_000)).toBe(5 * 60_000); // quarter of 20m
    expect(computeHeartbeatIntervalMs(24 * 60 * 60_000)).toBe(10 * 60_000); // capped
    expect(computeHeartbeatIntervalMs(5 * 60_000)).toBe(75_000); // quarter of 5m = 75s
  });
  it('always lands before the warning would show', () => {
    for (const minutes of [5, 20, 60, 1440]) {
      const t = sessionTimeoutMs(minutes);
      expect(computeHeartbeatIntervalMs(t)).toBeLessThan(t - computeWarningLeadMs(t));
    }
  });
});

describe('serverIdleTimeoutMs', () => {
  it('is the client window plus a grace margin', () => {
    const t = sessionTimeoutMs(20);
    expect(serverIdleTimeoutMs(20)).toBe(t + computeServerIdleGraceMs(t));
    // Always strictly greater than the client limit, so the client logs out first.
    expect(serverIdleTimeoutMs(20)).toBeGreaterThan(t);
  });
  it('is 0 for an invalid setting', () => {
    expect(serverIdleTimeoutMs(0)).toBe(0);
  });
});

describe('isSessionIdleExpired', () => {
  const limit = 20 * 60_000;
  it('is false within the window', () => {
    const now = 1_000_000_000_000;
    expect(isSessionIdleExpired(now - limit + 1, limit, now)).toBe(false);
  });
  it('is true past the window', () => {
    const now = 1_000_000_000_000;
    expect(isSessionIdleExpired(now - limit - 1, limit, now)).toBe(true);
  });
  it('treats missing values as not-expired (legacy/untracked tokens stay active)', () => {
    const now = 1_000_000_000_000;
    expect(isSessionIdleExpired(undefined, limit, now)).toBe(false);
    expect(isSessionIdleExpired(now, undefined, now)).toBe(false);
    expect(isSessionIdleExpired(now, 0, now)).toBe(false);
  });
});
