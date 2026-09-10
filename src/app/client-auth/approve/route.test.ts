import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const createCodeMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/client-auth-codes', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createClientAuthCode: createCodeMock,
}));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: logMock }));
vi.mock('@/lib/api/activity', () => ({ logError: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { POST } from './route';

const CHALLENGE = 'A'.repeat(43);
const REDIRECT = 'http://127.0.0.1:49152/callback';

const makeReq = (fields: Record<string, string>) => {
  const form = new URLSearchParams(fields);
  return new Request('http://localhost/client-auth/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
};

const goodFields = {
  redirect_uri: REDIRECT,
  state: 'opaque-state',
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  device_name: 'lab-pc',
};

const signedIn = (over: Record<string, unknown> = {}) => ({
  user: { id: 'u1', email: 'a@b.c', inactive: false, mustChangePassword: false, ...over },
});

beforeEach(() => {
  vi.clearAllMocks();
  logMock.mockResolvedValue(undefined);
});

describe('POST /client-auth/approve', () => {
  it('401 with no session', async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(makeReq(goodFields))).status).toBe(401);
    expect(createCodeMock).not.toHaveBeenCalled();
  });

  it('401 for an inactive account', async () => {
    authMock.mockResolvedValue(signedIn({ inactive: true }));
    expect((await POST(makeReq(goodFields))).status).toBe(401);
  });

  it('403 for a temporary-password session, which no other layer gates here', async () => {
    authMock.mockResolvedValue(signedIn({ mustChangePassword: true }));
    const res = await POST(makeReq(goodFields));
    expect(res.status).toBe(403);
    expect(createCodeMock).not.toHaveBeenCalled();
  });

  it('400 for a localhost redirect, and logs the refusal', async () => {
    authMock.mockResolvedValue(signedIn());
    const res = await POST(
      makeReq({ ...goodFields, redirect_uri: 'http://localhost:49152/callback' }),
    );
    expect(res.status).toBe(400);
    expect(createCodeMock).not.toHaveBeenCalled();
    expect(logMock.mock.calls[0][2].action).toBe('CLIENT_AUTH_APPROVE_REFUSED');
  });

  it('400 for a malformed challenge or wrong method', async () => {
    authMock.mockResolvedValue(signedIn());
    expect((await POST(makeReq({ ...goodFields, code_challenge: 'short' }))).status).toBe(400);
    expect(
      (await POST(makeReq({ ...goodFields, code_challenge_method: 'plain' }))).status,
    ).toBe(400);
  });

  it('303 to the loopback redirect with code and state on approval', async () => {
    authMock.mockResolvedValue(signedIn());
    createCodeMock.mockResolvedValue({ code: 'issued-code', expiresAt: new Date() });

    const res = await POST(makeReq(goodFields));
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get('code')).toBe('issued-code');
    expect(location.searchParams.get('state')).toBe('opaque-state');
    expect(createCodeMock).toHaveBeenCalledWith('u1', {
      pkceChallenge: CHALLENGE,
      redirectUri: REDIRECT,
      deviceName: 'lab-pc',
    });
    expect(logMock.mock.calls[0][2].action).toBe('CLIENT_AUTH_APPROVED');
  });
});
