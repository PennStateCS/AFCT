import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth', () => ({ auth: authMock }));

const listMock = vi.hoisted(() => vi.fn());
const unlinkMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/linked-identity', () => ({
  listIdentitiesForUser: listMock,
  unlinkIdentity: unlinkMock,
}));
vi.mock('@/lib/account-credentials', () => ({
  linkedAccountPasswordsAllowed: vi.fn().mockResolvedValue(false),
  canSetInitialPassword: vi.fn().mockReturnValue(false),
}));

import { GET } from './route';
import { DELETE } from './[id]/route';

const del = () =>
  DELETE(new Request('http://localhost/api/me/identities/i1', { method: 'DELETE' }), {
    params: Promise.resolve({ id: 'i1' }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'me' } });
  prismaMock.user.findUnique.mockResolvedValue({ password: 'hash' });
  listMock.mockResolvedValue([]);
  unlinkMock.mockResolvedValue('ok');
});

/**
 * A session AFCT has revoked still carries its user id, deliberately, so the rest of the app can
 * say who the caller was. `inactive` is what everything else refuses on, and these two routes
 * change how an account can be signed into, which is exactly what a revocation is protecting.
 */
describe('a revoked session', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { id: 'me', inactive: true } });
  });

  it('cannot list the ways into the account', async () => {
    expect((await GET()).status).toBe(401);
    // Refused before the read, not after it.
    expect(listMock).not.toHaveBeenCalled();
  });

  it('cannot disconnect one', async () => {
    expect((await del()).status).toBe(401);
    expect(unlinkMock).not.toHaveBeenCalled();
  });
});

describe('an ordinary session', () => {
  it('lists the identities on the account', async () => {
    listMock.mockResolvedValue([{ id: 'i1', provider: 'oidc' }]);

    const res = await GET();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      identities: [{ id: 'i1' }],
      hasPassword: true,
    });
  });

  it('disconnects one', async () => {
    expect((await del()).status).toBe(200);
    expect(unlinkMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1', userId: 'me' }));
  });
});
