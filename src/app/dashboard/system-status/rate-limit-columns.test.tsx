/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { getRateLimitColumns } from './rate-limit-columns';
import type { RateLimitedAddress } from '@/lib/status/types';

const NOW = 1_700_000_000_000;

const entry = (over: Partial<RateLimitedAddress> = {}): RateLimitedAddress => ({
  id: 'login:ip:203.0.113.5',
  ip: '203.0.113.5',
  scope: 'login:ip',
  scopeLabel: 'Sign-in attempts',
  state: 'blocked',
  reason: 'Too many failed sign-in attempts from this address',
  startedAt: NOW - 5 * 60_000,
  expiresAt: NOW + 25 * 60_000,
  attempts: 21,
  attemptsWhileRestricted: 4,
  lastAttemptAt: NOW - 30_000,
  details: {
    version: 4,
    kind: 'public',
    kindLabel: 'Public internet address',
    hostname: 'lab-12.cs.example.edu',
    hostnameLookup: 'ok',
    knownActivity: {
      windowDays: 30,
      eventCount: 482,
      accountCount: 12,
      accounts: ['a@example.edu'],
      firstSeen: NOW - 20 * 24 * 3600_000,
      lastSeen: NOW - 30_000,
      truncated: false,
    },
  },
  ...over,
});

const columns = () =>
  getRateLimitColumns({
    timeZone: 'UTC',
    generatedAt: NOW,
    onClear: vi.fn(),
    clearingIp: null,
  });

/** The value the table sorts and filters on, independent of how the cell renders. */
const valueOf = (id: string, row: RateLimitedAddress) => {
  const col = columns().find((c) => c.id === id || (c as { accessorKey?: string }).accessorKey === id);
  const fn = (col as { accessorFn?: (r: RateLimitedAddress, i: number) => unknown } | undefined)
    ?.accessorFn;
  return fn ? fn(row, 0) : undefined;
};

describe('rate-limit columns', () => {
  /**
   * The table has no toolbar, so nothing can reach a column that is not displayed. Two
   * filter-only columns used to exist to drive the Filters popover; they went with it. This
   * fails if somebody adds another hidden column, which would be data nobody could ever see.
   */
  it('defines no column the table cannot show', () => {
    const ids = columns().map((c) => c.id);

    expect(ids).not.toContain('addressType');
    expect(ids).not.toContain('familiarity');
  });

  it('reduces the state to the two words the filter offers', () => {
    expect(valueOf('state', entry())).toBe('Blocked');
    expect(valueOf('state', entry({ state: 'challenge' }))).toBe('Challenged');
  });

  it('sorts Seen before by account count, putting unchecked rows last', () => {
    expect(valueOf('seenBefore', entry())).toBe(12);
    const unchecked = entry();
    unchecked.details = { ...unchecked.details, knownActivity: null };
    expect(valueOf('seenBefore', unchecked)).toBe(-1);
  });

  it('keeps the actions column out of sorting and hiding', () => {
    const actions = columns().find((c) => c.id === 'actions');
    expect(actions?.enableSorting).toBe(false);
    expect(actions?.enableHiding).toBe(false);
  });
});
