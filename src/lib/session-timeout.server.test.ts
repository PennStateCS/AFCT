import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { getServerIdleTimeoutMs, __resetIdleTimeoutCacheForTests } from './session-timeout.server';
import { serverIdleTimeoutMs } from './session-timeout';
import { DEFAULT_SESSION_TIMEOUT_MINUTES } from './system-settings';

beforeEach(() => {
  vi.clearAllMocks();
  __resetIdleTimeoutCacheForTests();
});

describe('getServerIdleTimeoutMs', () => {
  it('reads the setting and returns the server idle limit', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ sessionTimeoutMinutes: 20 });
    expect(await getServerIdleTimeoutMs(1000)).toBe(serverIdleTimeoutMs(20));
  });

  it('clamps an out-of-range setting', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ sessionTimeoutMinutes: 99999 });
    // 1440 is the max session-timeout minutes.
    expect(await getServerIdleTimeoutMs(1000)).toBe(serverIdleTimeoutMs(1440));
  });

  it('falls back to the default on a DB error', async () => {
    prismaMock.systemSettings.findUnique.mockRejectedValue(new Error('down'));
    expect(await getServerIdleTimeoutMs(1000)).toBe(
      serverIdleTimeoutMs(DEFAULT_SESSION_TIMEOUT_MINUTES),
    );
  });

  it('caches within the TTL and re-reads after it lapses', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ sessionTimeoutMinutes: 20 });
    await getServerIdleTimeoutMs(1000);
    await getServerIdleTimeoutMs(5000); // within 30s TTL, cached
    expect(prismaMock.systemSettings.findUnique).toHaveBeenCalledTimes(1);
    await getServerIdleTimeoutMs(1000 + 31_000); // past TTL, re-reads
    expect(prismaMock.systemSettings.findUnique).toHaveBeenCalledTimes(2);
  });
});
