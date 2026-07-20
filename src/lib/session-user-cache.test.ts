import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  getSessionUser,
  invalidateSessionUser,
  clearSessionUserCache,
  SESSION_USER_TTL_MS,
} from './session-user-cache';

const row = (over: Record<string, unknown> = {}) => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  isAdmin: false,
  avatar: null,
  temporaryPassword: false,
  inactive: false,
  passwordChangedAt: null,
  cropX: null,
  cropY: null,
  zoom: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  clearSessionUserCache();
});

describe('session user cache', () => {
  it('collapses a burst of parallel requests into a single query', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row());
    const now = 1_000_000;

    // What one dashboard load looks like: several API calls, same user, same instant.
    await Promise.all([
      getSessionUser('u1', now),
      getSessionUser('u1', now),
      getSessionUser('u1', now),
      getSessionUser('u1', now),
      getSessionUser('u1', now),
    ]);

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('re-reads once the TTL lapses', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row());
    const now = 1_000_000;

    await getSessionUser('u1', now);
    await getSessionUser('u1', now + SESSION_USER_TTL_MS - 1);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);

    await getSessionUser('u1', now + SESSION_USER_TTL_MS + 1);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('keeps users separate', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row());
    const now = 1_000_000;

    await getSessionUser('u1', now);
    await getSessionUser('u2', now);

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('serves a revocation immediately after invalidation, not at TTL', async () => {
    // This is the property that makes the cache safe: disabling an account takes
    // effect on the very next request, well inside the TTL.
    prismaMock.user.findUnique.mockResolvedValue(row({ isAdmin: true }));
    const now = 1_000_000;

    const before = await getSessionUser('u1', now);
    expect(before?.isAdmin).toBe(true);

    prismaMock.user.findUnique.mockResolvedValue(row({ isAdmin: false, inactive: true }));
    invalidateSessionUser('u1');

    const after = await getSessionUser('u1', now + 1);
    expect(after?.isAdmin).toBe(false);
    expect(after?.inactive).toBe(true);
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(2);
  });

  it('caches a deleted account as null instead of querying every time', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const now = 1_000_000;

    expect(await getSessionUser('gone', now)).toBeNull();
    expect(await getSessionUser('gone', now)).toBeNull();

    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('selects only the columns the session needs', async () => {
    prismaMock.user.findUnique.mockResolvedValue(row());
    await getSessionUser('u1', 1_000_000);

    const select = prismaMock.user.findUnique.mock.calls[0][0].select;
    expect(select.isAdmin).toBe(true);
    expect(select.inactive).toBe(true);
    expect(select.passwordChangedAt).toBe(true);
    // Never widen this into the password hash.
    expect(select.password).toBeUndefined();
  });
});
