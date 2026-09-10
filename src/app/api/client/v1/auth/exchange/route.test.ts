import { describe, it, expect, vi, beforeEach } from 'vitest';

const exchangeMock = vi.hoisted(() => vi.fn());
const issueMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());
const rateMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({ user: { findUnique: vi.fn() } }));

vi.mock('@/lib/client-auth-codes', () => ({ exchangeClientAuthCode: exchangeMock }));
vi.mock('@/lib/client-auth', () => ({ issueClientToken: issueMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: logMock }));
vi.mock('@/lib/api/activity', () => ({ logError: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/security/rate-limiter', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  evaluateClientExchangeRateLimit: rateMock,
}));

import { POST } from './route';

const VERIFIER = 'a'.repeat(43);
const REDIRECT = 'http://127.0.0.1:49152/callback';

const makeReq = (body: unknown) =>
  new Request('http://localhost/api/client/v1/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const goodBody = { code: 'the-code', codeVerifier: VERIFIER, redirectUri: REDIRECT };

beforeEach(() => {
  vi.clearAllMocks();
  logMock.mockResolvedValue(undefined);
  rateMock.mockReturnValue({ status: 'ok', applyFriction: false, frictionDelayMs: 0 });
});

describe('POST /api/client/v1/auth/exchange', () => {
  it('429 with Retry-After when the IP is rate limited', async () => {
    rateMock.mockReturnValue({ status: 'blocked', retryAfterMs: 60_000, reason: 'ip' });
    const res = await POST(makeReq(goodBody));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('400 when the body is malformed', async () => {
    const res = await POST(makeReq({ code: 'x' }));
    expect(res.status).toBe(400);
    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('400 when the verifier is outside RFC 7636 bounds', async () => {
    expect((await POST(makeReq({ ...goodBody, codeVerifier: 'short' }))).status).toBe(400);
  });

  it('401 with a generic body on every refusal reason, and logs the specific one', async () => {
    for (const reason of ['unknown_code', 'replayed', 'expired', 'redirect_mismatch', 'pkce_mismatch']) {
      exchangeMock.mockResolvedValue({ ok: false, reason });
      const res = await POST(makeReq(goodBody));
      expect(res.status).toBe(401);
      // The body must not tell a probe which check failed.
      expect(JSON.stringify(await res.json())).not.toContain(reason);
    }
    const reasons = logMock.mock.calls.map((c) => c[2].metadata.reason);
    expect(reasons).toEqual(['unknown_code', 'replayed', 'expired', 'redirect_mismatch', 'pkce_mismatch']);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it('issues a token labeled with the stored device name on success', async () => {
    exchangeMock.mockResolvedValue({ ok: true, userId: 'u1', deviceName: 'lab-pc' });
    const expiresAt = new Date(Date.now() + 1000);
    issueMock.mockResolvedValue({ token: 'plaintext-token', tokenId: 't1', expiresAt });
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'a@b.c',
      firstName: 'A',
      lastName: 'B',
    });

    const res = await POST(makeReq(goodBody));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('plaintext-token');
    expect(body.user.email).toBe('a@b.c');
    expect(issueMock).toHaveBeenCalledWith('u1', { label: 'lab-pc' });
    // The sign-in method is a study variable: the log entry must carry it.
    const loginLog = logMock.mock.calls.find((c) => c[2].action === 'CLIENT_LOGIN');
    expect(loginLog?.[2].metadata.provider).toBe('browser-approval');
  });
});
