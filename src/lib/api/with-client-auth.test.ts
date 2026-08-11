import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());
let clientIp = '10.0.0.1';
vi.mock('@/lib/client-auth', () => ({ resolveClientTokenDetailed: resolveMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: logMock }));
vi.mock('@/lib/security/rate-limiter', () => ({ getClientIp: () => clientIp }));

import { withClientAuth } from './with-client-auth';

const makeReq = (authHeader?: string) =>
  new Request('http://localhost/api/client/v1/x', {
    headers: authHeader ? { authorization: authHeader } : {},
  });

// Each test uses a fresh IP so the module-level per-IP throttle doesn't bleed across tests.
let ipCounter = 0;
beforeEach(() => {
  clientIp = `10.0.0.${++ipCounter}`;
});

const ctx = { params: Promise.resolve({}) };

beforeEach(() => vi.clearAllMocks());

describe('withClientAuth', () => {
  it('401 when there is no Authorization header (no security log — nothing was presented)', async () => {
    const handler = vi.fn();
    const res = await withClientAuth(handler)(makeReq(), ctx);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it('401 when the header is not a Bearer token', async () => {
    const handler = vi.fn();
    const res = await withClientAuth(handler)(makeReq('Basic abc'), ctx);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it('401 and a SECURITY log when a presented token does not resolve', async () => {
    resolveMock.mockResolvedValue({ ok: false, reason: 'expired' });
    const handler = vi.fn();
    const res = await withClientAuth(handler)(makeReq('Bearer bad'), ctx);
    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(resolveMock).toHaveBeenCalledWith('bad');
    // Wait a tick; the log is fire-and-forget (void).
    await Promise.resolve();
    expect(logMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'CLIENT_TOKEN_REJECTED',
        severity: 'SECURITY',
        // Which rejection it was: expired and revoked need different answers.
        metadata: { reason: 'expired' },
      }),
    );
  });

  it('throttles the rejected-token log per IP', async () => {
    resolveMock.mockResolvedValue({ ok: false, reason: 'revoked' });
    const handler = vi.fn();
    const wrapped = withClientAuth(handler);
    await wrapped(makeReq('Bearer bad'), ctx);
    await wrapped(makeReq('Bearer bad'), ctx);
    await wrapped(makeReq('Bearer bad'), ctx);
    await Promise.resolve();
    // Three rejections from one IP inside the window → a single log entry.
    expect(logMock).toHaveBeenCalledTimes(1);
  });

  it('runs the handler with the resolved user for a valid token', async () => {
    resolveMock.mockResolvedValue({
      ok: true,
      token: {
        tokenId: 't1',
        user: { id: 'u1', isAdmin: false, email: 'a@b.c', firstName: null, lastName: null },
      },
    });
    const handler = vi.fn().mockResolvedValue(new Response('ok'));

    const res = await withClientAuth(handler)(makeReq('Bearer good'), ctx);

    expect(handler).toHaveBeenCalledWith(expect.anything(), ctx, {
      user: expect.objectContaining({ id: 'u1' }),
      tokenId: 't1',
    });
    expect(await res.text()).toBe('ok');
  });

  // Returning an object where the old code returned null: every shape must still 401.
  it.each([
    'unknown token',
    'revoked',
    'expired',
    'past maximum age',
    'account disabled',
    'password changed since the token was issued',
    'account locked',
  ] as const)('still refuses a token rejected as %s', async (reason) => {
    resolveMock.mockResolvedValue({ ok: false, reason });
    const handler = vi.fn();

    const res = await withClientAuth(handler)(makeReq('Bearer bad'), ctx);

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });
});
