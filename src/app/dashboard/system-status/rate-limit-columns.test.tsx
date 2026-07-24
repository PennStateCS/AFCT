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
  it('offers exactly the filters an administrator triages by', () => {
    const filterable = columns()
      .filter((c) => c.meta?.filterVariant)
      .map((c) => ({ label: c.meta?.filterLabel, variant: c.meta?.filterVariant }));

    expect(filterable).toEqual([
      { label: 'Status', variant: 'multiselect' },
      { label: 'Limit', variant: 'multiselect' },
      { label: 'Address type', variant: 'multiselect' },
      { label: 'Familiarity', variant: 'multiselect' },
    ]);
  });

  it('reduces the state to the two words the filter offers', () => {
    expect(valueOf('state', entry())).toBe('Blocked');
    expect(valueOf('state', entry({ state: 'challenge' }))).toBe('Challenged');
  });

  it('filters by address type using the plain-language label', () => {
    expect(valueOf('addressType', entry())).toBe('Public internet address');
    const priv = entry();
    priv.details = { ...priv.details, kindLabel: 'Private network address' };
    expect(valueOf('addressType', priv)).toBe('Private network address');
  });

  it('separates addresses we have seen from strangers', () => {
    expect(valueOf('familiarity', entry())).toBe('Seen before');

    const unseen = entry();
    unseen.details = {
      ...unseen.details,
      knownActivity: { ...unseen.details.knownActivity!, eventCount: 0, accountCount: 0 },
    };
    expect(valueOf('familiarity', unseen)).toBe('Not seen before');

    // A failed activity lookup is its own bucket, not silently "new".
    const unchecked = entry();
    unchecked.details = { ...unchecked.details, knownActivity: null };
    expect(valueOf('familiarity', unchecked)).toBe('Not checked');
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
