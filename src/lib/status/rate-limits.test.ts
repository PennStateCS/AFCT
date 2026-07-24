import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  activityLog: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));
const dnsReverseMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('dns', () => ({ promises: { reverse: dnsReverseMock } }));

import { collectRateLimits, __clearPtrCache } from '@/lib/status/rate-limits';
import {
  evaluateCheckEmailRateLimit,
  __dangerousResetRateLimiter,
} from '@/lib/security/rate-limiter';

/** The check-email limit blocks an address on its 31st request in the window. */
const block = (ip: string) => {
  for (let i = 0; i < 31; i++) evaluateCheckEmailRateLimit({ ip });
};

beforeEach(() => {
  vi.clearAllMocks();
  __dangerousResetRateLimiter();
  __clearPtrCache();
  prismaMock.activityLog.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  dnsReverseMock.mockResolvedValue([]);
});

describe('collectRateLimits', () => {
  it('returns nothing to show when no address is restricted', async () => {
    const result = await collectRateLimits();
    expect(result.entries).toEqual([]);
    expect(dnsReverseMock).not.toHaveBeenCalled();
    // No addresses means no reason to touch the activity log at all.
    expect(prismaMock.activityLog.findMany).not.toHaveBeenCalled();
  });

  it('reuses a cached reverse-DNS result across refreshes', async () => {
    dnsReverseMock.mockResolvedValue(['lab-1.example.edu']);
    block('203.0.113.20');

    const first = await collectRateLimits();
    const second = await collectRateLimits();

    expect(first.entries[0]!.details.hostname).toBe('lab-1.example.edu');
    expect(second.entries[0]!.details.hostname).toBe('lab-1.example.edu');
    // The tab polls every 15 seconds; the resolver is asked once, not once per poll.
    expect(dnsReverseMock).toHaveBeenCalledTimes(1);
  });

  it('reports an address with no PTR record as having no name, not as an error', async () => {
    dnsReverseMock.mockResolvedValue([]);
    block('203.0.113.21');

    const { entries } = await collectRateLimits();
    expect(entries[0]!.details).toMatchObject({ hostname: null, hostnameLookup: 'none' });
  });

  it('carries on when the resolver is unreachable', async () => {
    dnsReverseMock.mockRejectedValue(new Error('ENOTFOUND'));
    block('203.0.113.22');

    const { entries } = await collectRateLimits();
    expect(entries).toHaveLength(1);
    expect(entries[0]!.details).toMatchObject({ hostname: null, hostnameLookup: 'failed' });
  });

  it('queries the activity log once for every restricted address together', async () => {
    block('203.0.113.23');
    block('203.0.113.24');

    await collectRateLimits();

    expect(prismaMock.activityLog.findMany).toHaveBeenCalledTimes(1);
    const where = prismaMock.activityLog.findMany.mock.calls[0]![0].where;
    expect(where.ipAddress.in.sort()).toEqual(['203.0.113.23', '203.0.113.24']);
  });

  it('marks the counts as a floor when the scan cap is reached', async () => {
    const timestamp = new Date('2026-07-20T12:00:00.000Z');
    prismaMock.activityLog.findMany.mockResolvedValue(
      Array.from({ length: 2_000 }, () => ({
        ipAddress: '203.0.113.25',
        userId: 'u1',
        timestamp,
      })),
    );
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1', email: 'a@example.edu' }]);
    block('203.0.113.25');

    const { entries } = await collectRateLimits();
    expect(entries[0]!.details.knownActivity).toMatchObject({
      truncated: true,
      eventCount: 2_000,
      accountCount: 1,
    });
  });

  it('still lists an address the activity log has never seen', async () => {
    block('203.0.113.26');

    const { entries } = await collectRateLimits();
    expect(entries[0]!.details.knownActivity).toMatchObject({
      eventCount: 0,
      accountCount: 0,
      accounts: [],
      firstSeen: null,
      lastSeen: null,
    });
  });

  it('caps how many addresses are looked up, without dropping any from the list', async () => {
    // 26 restricted addresses against an enrichment cap of 25.
    for (let i = 0; i < 26; i++) block(`203.0.113.${100 + i}`);

    const { entries } = await collectRateLimits();

    // Every restriction is still reported: the cap limits lookups, not the list.
    expect(entries).toHaveLength(26);
    expect(dnsReverseMock).toHaveBeenCalledTimes(25);

    const looked = entries.filter((e) => e.details.knownActivity !== null);
    const skipped = entries.filter((e) => e.details.knownActivity === null);
    expect(looked).toHaveLength(25);
    expect(skipped).toHaveLength(1);
    // The one past the cap still gets the classification, which costs nothing.
    expect(skipped[0]!.details).toMatchObject({
      kind: 'public',
      version: 4,
      hostnameLookup: 'skipped',
    });
  });
});
