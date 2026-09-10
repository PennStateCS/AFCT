import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const prismaMock = vi.hoisted(() => ({
  clientAuthCode: {
    create: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import {
  validateClientRedirectUri,
  verifyPkce,
  createClientAuthCode,
  exchangeClientAuthCode,
} from './client-auth-codes';

beforeEach(() => vi.clearAllMocks());

describe('validateClientRedirectUri', () => {
  it('accepts 127.0.0.1 and [::1] with a port and path', () => {
    expect(validateClientRedirectUri('http://127.0.0.1:49152/callback')).toBe(
      'http://127.0.0.1:49152/callback',
    );
    expect(validateClientRedirectUri('http://[::1]:49152/callback')).toBe(
      'http://[::1]:49152/callback',
    );
  });

  it('rejects localhost, which a hosts file can point off this machine', () => {
    expect(validateClientRedirectUri('http://localhost:49152/callback')).toBeNull();
  });

  it('rejects non-loopback hosts and https', () => {
    expect(validateClientRedirectUri('http://192.168.1.5:49152/callback')).toBeNull();
    expect(validateClientRedirectUri('http://evil.example/callback')).toBeNull();
    expect(validateClientRedirectUri('https://127.0.0.1:49152/callback')).toBeNull();
  });

  it('rejects userinfo, query, fragment, and garbage', () => {
    expect(validateClientRedirectUri('http://user@127.0.0.1:49152/callback')).toBeNull();
    expect(validateClientRedirectUri('http://127.0.0.1:49152/callback?x=1')).toBeNull();
    expect(validateClientRedirectUri('http://127.0.0.1:49152/callback#frag')).toBeNull();
    expect(validateClientRedirectUri('not a url')).toBeNull();
  });
});

describe('verifyPkce', () => {
  const verifier = 'a'.repeat(43);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');

  it('accepts the matching S256 pair and rejects a wrong verifier', () => {
    expect(verifyPkce(challenge, verifier)).toBe(true);
    expect(verifyPkce(challenge, 'b'.repeat(43))).toBe(false);
  });
});

describe('exchangeClientAuthCode', () => {
  const verifier = 'a'.repeat(43);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const REDIRECT = 'http://127.0.0.1:49152/callback';

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'c1',
    userId: 'u1',
    pkceChallenge: challenge,
    redirectUri: REDIRECT,
    deviceName: 'lab-pc',
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...over,
  });

  const exchange = (over: Record<string, unknown> = {}) =>
    exchangeClientAuthCode({
      code: 'the-code',
      codeVerifier: verifier,
      redirectUri: REDIRECT,
      ...over,
    });

  it('succeeds and claims the code once', async () => {
    prismaMock.clientAuthCode.findUnique.mockResolvedValue(row());
    prismaMock.clientAuthCode.updateMany.mockResolvedValue({ count: 1 });
    expect(await exchange()).toEqual({ ok: true, userId: 'u1', deviceName: 'lab-pc' });
    // The claim must be guarded on usedAt, not a blind update: that guard is what
    // turns a race into one token and one refusal.
    expect(prismaMock.clientAuthCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it('refuses an unknown code', async () => {
    prismaMock.clientAuthCode.findUnique.mockResolvedValue(null);
    expect(await exchange()).toEqual({ ok: false, reason: 'unknown_code' });
  });

  it('refuses a replayed code', async () => {
    prismaMock.clientAuthCode.findUnique.mockResolvedValue(row({ usedAt: new Date() }));
    expect(await exchange()).toEqual({ ok: false, reason: 'replayed' });
    expect(prismaMock.clientAuthCode.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a code that lost the claim race', async () => {
    prismaMock.clientAuthCode.findUnique.mockResolvedValue(row());
    prismaMock.clientAuthCode.updateMany.mockResolvedValue({ count: 0 });
    expect(await exchange()).toEqual({ ok: false, reason: 'replayed' });
  });

  it('refuses an expired code', async () => {
    prismaMock.clientAuthCode.findUnique.mockResolvedValue(
      row({ expiresAt: new Date(Date.now() - 1) }),
    );
    expect(await exchange()).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a redirect that differs from the stored one', async () => {
    prismaMock.clientAuthCode.findUnique.mockResolvedValue(row());
    expect(await exchange({ redirectUri: 'http://127.0.0.1:49153/callback' })).toEqual({
      ok: false,
      reason: 'redirect_mismatch',
    });
  });

  it('refuses a device-code style row (null redirect) at this endpoint', async () => {
    prismaMock.clientAuthCode.findUnique.mockResolvedValue(row({ redirectUri: null }));
    expect(await exchange()).toEqual({ ok: false, reason: 'redirect_mismatch' });
  });

  it('refuses a wrong verifier without burning the code', async () => {
    prismaMock.clientAuthCode.findUnique.mockResolvedValue(row());
    expect(await exchange({ codeVerifier: 'b'.repeat(43) })).toEqual({
      ok: false,
      reason: 'pkce_mismatch',
    });
    expect(prismaMock.clientAuthCode.updateMany).not.toHaveBeenCalled();
  });

  it('stores only a hash when creating a code', async () => {
    prismaMock.clientAuthCode.create.mockResolvedValue({});
    const { code } = await createClientAuthCode('u1', {
      pkceChallenge: challenge,
      redirectUri: REDIRECT,
    });
    const stored = prismaMock.clientAuthCode.create.mock.calls[0][0].data;
    expect(stored.codeHash).toBe(crypto.createHash('sha256').update(code).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(code);
  });
});
