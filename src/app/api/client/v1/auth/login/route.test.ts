import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifyMock = vi.hoisted(() => vi.fn());
const issueMock = vi.hoisted(() => vi.fn());
const logMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/credentials', () => ({ verifyCredentials: verifyMock }));
vi.mock('@/lib/client-auth', () => ({ issueClientToken: issueMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: logMock }));
vi.mock('@/lib/api/activity', () => ({ logError: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { POST } from './route';

const makeReq = (body: unknown) =>
  new Request('http://localhost/api/client/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  logMock.mockResolvedValue(undefined);
});

describe('POST /api/client/v1/auth/login', () => {
  it('400 when the body is invalid', async () => {
    const res = await POST(makeReq({ email: 'not-an-email' }));
    expect(res.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('401 on invalid credentials', async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: 'invalid' });
    const res = await POST(makeReq({ email: 'a@b.c', password: 'x' }));
    expect(res.status).toBe(401);
    expect(issueMock).not.toHaveBeenCalled();
  });

  it('429 with Retry-After when rate limited', async () => {
    verifyMock.mockResolvedValue({ ok: false, reason: 'rate_limited', retryAfterMs: 90_000 });
    const res = await POST(makeReq({ email: 'a@b.c', password: 'x' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('90');
    expect(issueMock).not.toHaveBeenCalled();
  });

  it('issues a token and returns the user on success', async () => {
    verifyMock.mockResolvedValue({
      ok: true,
      user: { id: 'u1', email: 'a@b.c', firstName: 'A', lastName: 'B' },
    });
    const expiresAt = new Date(Date.now() + 1000);
    issueMock.mockResolvedValue({ token: 'plaintext-token', tokenId: 't1', expiresAt });

    const res = await POST(makeReq({ email: 'a@b.c', password: 'x', deviceName: 'lab-pc' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe('plaintext-token');
    expect(body.expiresAt).toBe(expiresAt.toISOString());
    expect(body.user).toEqual({ id: 'u1', email: 'a@b.c', firstName: 'A', lastName: 'B' });
    expect(issueMock).toHaveBeenCalledWith('u1', { label: 'lab-pc' });
    expect(logMock).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({ action: 'CLIENT_LOGIN' }),
    );
  });
});
