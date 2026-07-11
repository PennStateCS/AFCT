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
