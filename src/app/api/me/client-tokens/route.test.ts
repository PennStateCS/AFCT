import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  clientApiToken: { findMany: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: vi.fn() }));

const issueMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/client-auth', () => ({
  issueClientToken: issueMock,
  CLIENT_TOKEN_TTL_MS: 1000,
}));

import { GET, POST } from './route';
import { DELETE } from './[id]/route';

const req = (body?: unknown) =>
  new Request('http://localhost/api/me/client-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'me' } });
  prismaMock.clientApiToken.findMany.mockResolvedValue([]);
  prismaMock.clientApiToken.updateMany.mockResolvedValue({ count: 1 });
  issueMock.mockResolvedValue({ token: 'plain', tokenId: 't1', expiresAt: new Date() });
});

describe('signed out', () => {
  it('refuses every operation', async () => {
    authMock.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
    expect((await POST(req())).status).toBe(401);
    expect(
      (await DELETE(new Request('http://localhost'), { params: Promise.resolve({ id: 't1' }) }))
        .status,
    ).toBe(401);
  });
});

/**
 * A token is a way into someone's account. Every query is keyed on the session rather than on
 * anything the caller supplies, so asking for another person's tokens is not a thing this route
 * can be talked into.
 */
describe('scoping to the caller', () => {
  it('lists only the tokens belonging to the caller', async () => {
    await GET();

    expect(prismaMock.clientApiToken.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'me' }) }),
    );
  });

  it('never returns the stored hash', async () => {
    await GET();

    const select = prismaMock.clientApiToken.findMany.mock.calls[0][0].select;
    expect(select.tokenHash).toBeUndefined();
  });

  // Scoped in the `where`, not checked first: another person's id matches nothing rather than
  // revoking their access.
  it('revokes only a token the caller owns', async () => {
    await DELETE(new Request('http://localhost'), { params: Promise.resolve({ id: 't1' }) });

    expect(prismaMock.clientApiToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 't1', userId: 'me' }) }),
    );
  });

  it('reports another persons token as missing', async () => {
    prismaMock.clientApiToken.updateMany.mockResolvedValue({ count: 0 });

    const res = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'someone-elses' }),
    });

    expect(res.status).toBe(404);
  });
});

describe('issuing', () => {
  it('returns the plaintext exactly once, on creation', async () => {
    const res = await POST(req({ label: 'My laptop' }));

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ token: 'plain' });
    expect(issueMock).toHaveBeenCalledWith('me', expect.objectContaining({ label: 'My laptop' }));
  });

  it('rejects a label that is far too long', async () => {
    const res = await POST(req({ label: 'x'.repeat(200) }));

    expect(res.status).toBe(400);
    expect(issueMock).not.toHaveBeenCalled();
  });
});
