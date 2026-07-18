import { beforeEach, describe, expect, it, vi } from 'vitest';

const peekMock = vi.hoisted(() => vi.fn());
const policyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/security/rate-limiter', () => ({
  peekLoginRateLimit: peekMock,
  getClientIp: () => '1.2.3.4',
}));
vi.mock('@/lib/login-policy', () => ({ getLoginLockoutPolicy: policyMock }));

import { POST } from './route';

const post = (body: unknown) =>
  new Request('http://localhost/api/auth/login-check', {
    method: 'POST',
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  policyMock.mockResolvedValue({ maxAttempts: 10, blockDurationMs: 1000 });
});

describe('POST /api/auth/login-check', () => {
  it('echoes the peeked status and normalizes the email identifier', async () => {
    peekMock.mockReturnValue({ status: 'challenge', retryAfterMs: 5000, reason: 'account' });

    const res = await POST(post({ email: '  Admin@Example.COM ' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'challenge', retryAfterMs: 5000 });
    expect(peekMock).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'admin@example.com', ip: '1.2.3.4' }),
    );
  });

  it('returns retryAfterMs 0 when ok, and tolerates a missing/invalid body', async () => {
    peekMock.mockReturnValue({ status: 'ok', applyFriction: false, frictionDelayMs: 0 });

    const res = await POST(
      new Request('http://localhost/api/auth/login-check', { method: 'POST', body: 'not-json' }),
    );

    expect(await res.json()).toEqual({ status: 'ok', retryAfterMs: 0 });
    expect(peekMock).toHaveBeenCalledWith(expect.objectContaining({ identifier: undefined }));
  });

  it('reports a block', async () => {
    peekMock.mockReturnValue({ status: 'blocked', retryAfterMs: 120000, reason: 'ip' });
    const res = await POST(post({ email: 'x@y.z' }));
    expect(await res.json()).toEqual({ status: 'blocked', retryAfterMs: 120000 });
  });
});
