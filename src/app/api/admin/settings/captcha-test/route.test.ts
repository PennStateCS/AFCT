import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routeCtx } from '@/test/route';

const authMock = vi.hoisted(() => vi.fn());
const verifyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: vi.fn() }));
vi.mock('@/lib/security/captcha', () => ({ verifyCaptchaToken: verifyMock }));
vi.mock('@/lib/security/rate-limiter', () => ({ getClientIp: () => '1.2.3.4' }));

import { POST } from './route';

const post = (body: unknown) =>
  new Request('http://localhost/api/admin/settings/captcha-test', {
    method: 'POST',
    body: JSON.stringify(body),
  });

const admin = { user: { id: 'a1', role: 'ADMIN', isAdmin: true } };

beforeEach(() => vi.clearAllMocks());

describe('POST /api/admin/settings/captcha-test', () => {
  it('403s a non-admin without verifying anything', async () => {
    authMock.mockResolvedValue({ user: { id: 'f1', role: 'FACULTY' } });
    const res = await POST(post({ token: 't' }), routeCtx());
    expect(res.status).toBe(403);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('verifies the token against the stored secret and returns ok:true', async () => {
    authMock.mockResolvedValue(admin);
    verifyMock.mockResolvedValue(true);

    const res = await POST(post({ token: 'good-token' }), routeCtx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(verifyMock).toHaveBeenCalledWith('good-token', '1.2.3.4');
  });

  it('returns ok:false when the token does not verify', async () => {
    authMock.mockResolvedValue(admin);
    verifyMock.mockResolvedValue(false);

    const res = await POST(post({ token: 'bad-token' }), routeCtx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
  });

  it('400s when the token is missing', async () => {
    authMock.mockResolvedValue(admin);
    const res = await POST(post({}), routeCtx());
    expect(res.status).toBe(400);
    expect(verifyMock).not.toHaveBeenCalled();
  });
});
