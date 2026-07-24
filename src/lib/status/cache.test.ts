import { beforeEach, describe, expect, it, vi } from 'vitest';
import { boundedCache, cached, clearStatusCache } from '@/lib/status/cache';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_700_000_000_000);
  clearStatusCache();
});

describe('boundedCache', () => {
  it('runs the producer once inside the TTL and again after it', async () => {
    const cache = boundedCache<number>({ max: 10, ttlMs: 60_000 });
    const produce = vi.fn(async () => 1);

    await cache.get('a', produce);
    await cache.get('a', produce);
    expect(produce).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_001);
    await cache.get('a', produce);
    expect(produce).toHaveBeenCalledTimes(2);
  });

  it('keeps distinct keys apart', async () => {
    const cache = boundedCache<string>({ max: 10, ttlMs: 60_000 });
    expect(await cache.get('a', async () => 'first')).toBe('first');
    expect(await cache.get('b', async () => 'second')).toBe('second');
    expect(await cache.get('a', async () => 'ignored')).toBe('first');
  });

  it('evicts oldest-first instead of growing past the cap', async () => {
    const cache = boundedCache<number>({ max: 3, ttlMs: 60_000 });
    for (let i = 0; i < 50; i++) await cache.get(`k${i}`, async () => i);

    expect(cache.size()).toBeLessThanOrEqual(3);
    // The first key is long gone, so its producer runs again.
    const produce = vi.fn(async () => 0);
    await cache.get('k0', produce);
    expect(produce).toHaveBeenCalledTimes(1);
  });

  it('does not cache a thrown producer', async () => {
    const cache = boundedCache<number>({ max: 10, ttlMs: 60_000 });
    await expect(cache.get('a', async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(cache.size()).toBe(0);
    expect(await cache.get('a', async () => 7)).toBe(7);
  });

  it('is cleared by the shared reset along with the fixed-key store', async () => {
    const cache = boundedCache<number>({ max: 10, ttlMs: 60_000 });
    const bounded = vi.fn(async () => 1);
    const fixed = vi.fn(async () => 2);
    await cache.get('a', bounded);
    await cached('fixed', 60_000, fixed);

    clearStatusCache();

    await cache.get('a', bounded);
    await cached('fixed', 60_000, fixed);
    expect(bounded).toHaveBeenCalledTimes(2);
    expect(fixed).toHaveBeenCalledTimes(2);
  });
});
