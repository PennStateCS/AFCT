import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  systemSettings: { findUnique: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { DEFAULT_TIMEZONE, resolveUserTimezone } from './user-timezone';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveUserTimezone', () => {
  it('returns the default when no userId is given, without querying', async () => {
    await expect(resolveUserTimezone(null)).resolves.toBe(DEFAULT_TIMEZONE);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it("prefers the user's own timezone", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' });

    await expect(resolveUserTimezone('u1')).resolves.toBe('Europe/Paris');
    expect(prismaMock.systemSettings.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to the system timezone when the user has none', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ timezone: null });
    prismaMock.systemSettings.findUnique.mockResolvedValue({ timezone: 'UTC' });

    await expect(resolveUserTimezone('u1')).resolves.toBe('UTC');
  });

  it('falls back to the default when neither is set', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ timezone: null });
    prismaMock.systemSettings.findUnique.mockResolvedValue(null);

    await expect(resolveUserTimezone('u1')).resolves.toBe(DEFAULT_TIMEZONE);
  });
});
