import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  clientApiToken: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  hashToken,
  issueClientToken,
  resolveClientToken,
  revokeClientToken,
  CLIENT_TOKEN_MAX_AGE_MS,
  CLIENT_TOKEN_TTL_MS,
} from './client-auth';

const activeUser = {
  id: 'u1',
  isAdmin: false,
  email: 'a@b.c',
  firstName: 'A',
  lastName: 'B',
  inactive: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.clientApiToken.update.mockResolvedValue({});
});

describe('client-auth', () => {
  it('hashToken is a deterministic 64-char sha256 hex', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toHaveLength(64);
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('issueClientToken stores only the hash and returns the plaintext once', async () => {
    prismaMock.clientApiToken.create.mockResolvedValue({ id: 't1' });
    const { token, tokenId, expiresAt } = await issueClientToken('u1', { label: 'dev' });

    expect(tokenId).toBe('t1');
    expect(token).toBeTruthy();
    const arg = prismaMock.clientApiToken.create.mock.calls[0]![0];
    expect(arg.data.tokenHash).toBe(hashToken(token));
    expect(arg.data.tokenHash).not.toBe(token); // never the plaintext
    expect(arg.data.userId).toBe('u1');
    expect(arg.data.label).toBe('dev');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('resolveClientToken returns the (active) user for a valid token', async () => {
    prismaMock.clientApiToken.findUnique.mockResolvedValue({
      id: 't1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
      lastUsedAt: null,
      user: activeUser,
    });

    const res = await resolveClientToken('tok');
    expect(res?.tokenId).toBe('t1');
    expect(res?.user.id).toBe('u1');
    // Looks up by the HASH, never the raw token.
    expect(prismaMock.clientApiToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken('tok') } }),
    );
    // The resolved user has no `inactive` field leaked into it.
    expect(res?.user).not.toHaveProperty('inactive');
    // Sliding expiration: a use renews both lastUsedAt and expiresAt.
    expect(prismaMock.clientApiToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: expect.objectContaining({ lastUsedAt: expect.any(Date), expiresAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects a token past its absolute max age even if expiresAt is still in the future', async () => {
    // Sliding expiration could push expiresAt out indefinitely; the absolute cap
    // (createdAt + MAX_AGE) still retires the token.
    prismaMock.clientApiToken.findUnique.mockResolvedValue({
      id: 't1',
      revokedAt: null,
      createdAt: new Date(Date.now() - CLIENT_TOKEN_MAX_AGE_MS - 1000),
      expiresAt: new Date(Date.now() + 10_000), // slid forward, still "valid"
      lastUsedAt: null,
      user: activeUser,
    });

    expect(await resolveClientToken('tok')).toBeNull();
    expect(prismaMock.clientApiToken.update).not.toHaveBeenCalled();
  });

  it('caps the slid expiresAt at createdAt + MAX_AGE, not now + TTL', async () => {
    // Created 70 days ago: still under the 90-day cap, so it resolves, but a renewal
    // must not push expiresAt a full TTL past now (that would exceed the cap).
    const createdAt = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000);
    prismaMock.clientApiToken.findUnique.mockResolvedValue({
      id: 't1',
      revokedAt: null,
      createdAt,
      expiresAt: new Date(Date.now() + 5_000),
      lastUsedAt: null,
      user: activeUser,
    });

    const res = await resolveClientToken('tok');
    expect(res?.tokenId).toBe('t1');

    const cap = createdAt.getTime() + CLIENT_TOKEN_MAX_AGE_MS;
    const written = prismaMock.clientApiToken.update.mock.calls[0]![0].data.expiresAt as Date;
    // Capped at createdAt + MAX_AGE, well short of now + TTL.
    expect(written.getTime()).toBeLessThanOrEqual(cap);
    expect(written.getTime()).toBeGreaterThan(Date.now() + 5_000);
    expect(written.getTime()).toBeLessThan(Date.now() + CLIENT_TOKEN_TTL_MS);
  });

  it('does not renew a token used within the throttle window', async () => {
    prismaMock.clientApiToken.findUnique.mockResolvedValue({
      id: 't1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 10_000),
      lastUsedAt: new Date(), // used just now
      user: activeUser,
    });
    await resolveClientToken('tok');
    expect(prismaMock.clientApiToken.update).not.toHaveBeenCalled();
  });

  it('returns null for unknown, revoked, expired, or inactive-user tokens', async () => {
    prismaMock.clientApiToken.findUnique.mockResolvedValueOnce(null);
    expect(await resolveClientToken('x')).toBeNull();

    prismaMock.clientApiToken.findUnique.mockResolvedValueOnce({
      id: 't',
      revokedAt: new Date(),
      expiresAt: null,
      lastUsedAt: null,
      user: activeUser,
    });
    expect(await resolveClientToken('x')).toBeNull();

    prismaMock.clientApiToken.findUnique.mockResolvedValueOnce({
      id: 't',
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
      lastUsedAt: null,
      user: activeUser,
    });
    expect(await resolveClientToken('x')).toBeNull();

    prismaMock.clientApiToken.findUnique.mockResolvedValueOnce({
      id: 't',
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: null,
      user: { ...activeUser, inactive: true },
    });
    expect(await resolveClientToken('x')).toBeNull();
  });

  it('revokeClientToken only touches non-revoked rows', async () => {
    prismaMock.clientApiToken.updateMany.mockResolvedValue({ count: 1 });
    await revokeClientToken('t1');
    expect(prismaMock.clientApiToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1', revokedAt: null } }),
    );
  });
});
