import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
const revokeMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/client-auth', () => ({
  resolveClientToken: resolveMock,
  revokeClientToken: revokeMock,
}));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: logMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { POST } from './route';

const makeReq = (authHeader?: string) =>
  new Request('http://localhost/api/client/v1/auth/logout', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  });
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  revokeMock.mockResolvedValue(undefined);
  logMock.mockResolvedValue(undefined);
});

/**
 * The native client's sign-out. It revokes the bearer token that authenticated the request,
 * which is the only way a student can cut off a machine they no longer control without an
 * administrator changing their password.
 */
describe('POST /api/client/v1/auth/logout', () => {
  it('401s without a valid token, and revokes nothing', async () => {
    resolveMock.mockResolvedValue(null);

    expect((await POST(makeReq(), ctx)).status).toBe(401);
    expect((await POST(makeReq('Bearer bad'), ctx)).status).toBe(401);
    expect(revokeMock).not.toHaveBeenCalled();
  });

  it('revokes the token that made the request, not one named in the body', async () => {
    // The token is taken from the Authorization header, so a caller cannot revoke
    // somebody else's session by naming it.
    resolveMock.mockResolvedValue({ tokenId: 't1', user: { id: 'u1', isAdmin: false } });

    const res = await POST(makeReq('Bearer good'), ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(revokeMock).toHaveBeenCalledWith('t1');
  });

  it('records the sign-out against the account', async () => {
    // The activity log is the audit trail for session lifecycle, so this entry has to
    // carry the actor and stay at its documented action and severity.
    resolveMock.mockResolvedValue({ tokenId: 't1', user: { id: 'u1', isAdmin: false } });

    await POST(makeReq('Bearer good'), ctx);

    expect(logMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        userId: 'u1',
        action: 'CLIENT_LOGOUT',
        severity: 'INFO',
        category: 'USER',
      }),
    );
  });

  it('is idempotent, so a client retrying a logout still succeeds', async () => {
    resolveMock.mockResolvedValue({ tokenId: 't1', user: { id: 'u1', isAdmin: false } });

    expect((await POST(makeReq('Bearer good'), ctx)).status).toBe(200);
    expect((await POST(makeReq('Bearer good'), ctx)).status).toBe(200);
    expect(revokeMock).toHaveBeenCalledTimes(2);
  });
});
