import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  systemSettings: { findUnique: vi.fn() },
  user: { findUnique: vi.fn(), create: vi.fn() },
  activityLog: { create: vi.fn() },
}));

const activityLogMock = vi.hoisted(() => vi.fn());
const bcryptMock = vi.hoisted(() => ({ hash: vi.fn() }));
const rateLimiterMock = vi.hoisted(() => ({
  evaluateSignupRateLimit: vi.fn(),
  applyBotFriction: vi.fn(),
  formatRetryAfterSeconds: vi.fn((ms: number) => Math.max(1, Math.ceil(ms / 1000)).toString()),
  getClientIp: vi.fn(() => '127.0.0.1'),
  recordSignupSuccess: vi.fn(),
}));
const captchaMock = vi.hoisted(() => ({ verifyCaptchaToken: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/security/rate-limiter', () => rateLimiterMock);
vi.mock('@/lib/security/captcha', () => captchaMock);
vi.mock('bcrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcrypt')>();
  return {
    ...actual,
    ...bcryptMock,
    default: {
      ...actual,
      ...bcryptMock,
    },
  };
});

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  bcryptMock.hash.mockResolvedValue('hashed');
  prismaMock.activityLog.create.mockResolvedValue(undefined);
  rateLimiterMock.evaluateSignupRateLimit.mockReturnValue({
    status: 'ok',
    applyFriction: false,
    frictionDelayMs: 0,
  });
  rateLimiterMock.applyBotFriction.mockResolvedValue(undefined);
  captchaMock.verifyCaptchaToken.mockResolvedValue(true);
  prismaMock.systemSettings.findUnique.mockResolvedValue({ id: 1, allowSignup: true });
});

describe('POST /api/auth/signup', () => {
  it('returns 403 when signup is disabled in system settings', async () => {
    prismaMock.systemSettings.findUnique.mockResolvedValue({ id: 1, allowSignup: false });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'Strong1!a',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('returns 400 when required fields missing', async () => {
    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@example.com' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when email invalid', async () => {
    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'bad-email',
        password: 'Strong1!a',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when password weak', async () => {
    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'weak',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 409 when email exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'Strong1!a',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(409);
  });

  it('creates user and logs activity', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'u1' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'Strong1!a',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalled();
    expect(activityLogMock).toHaveBeenCalled();
    expect(rateLimiterMock.recordSignupSuccess).toHaveBeenCalled();
  });

  it('returns 429 when rate limited', async () => {
    rateLimiterMock.evaluateSignupRateLimit.mockReturnValue({
      status: 'blocked',
      retryAfterMs: 90 * 1000,
      reason: 'ip',
    });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'Strong1!a',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(429);
    expect(rateLimiterMock.formatRetryAfterSeconds).toHaveBeenCalledWith(90 * 1000);
  });

  it('returns 428 when challenge requires captcha', async () => {
    rateLimiterMock.evaluateSignupRateLimit.mockReturnValue({
      status: 'challenge',
      retryAfterMs: 15 * 1000,
      reason: 'ip',
    });
    captchaMock.verifyCaptchaToken.mockResolvedValue(false);

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'Strong1!a',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(428);
    expect(captchaMock.verifyCaptchaToken).toHaveBeenCalledWith(undefined, '127.0.0.1');
  });

  it('allows signup when captcha solved during challenge', async () => {
    rateLimiterMock.evaluateSignupRateLimit.mockReturnValue({
      status: 'challenge',
      retryAfterMs: 15 * 1000,
      reason: 'ip',
    });
    captchaMock.verifyCaptchaToken.mockResolvedValue(true);
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'u1' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'Strong1!a',
        captchaToken: 'captcha-abc',
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalled();
    expect(captchaMock.verifyCaptchaToken).toHaveBeenCalledWith('captcha-abc', '127.0.0.1');
  });

  it('applies friction when requested', async () => {
    rateLimiterMock.evaluateSignupRateLimit.mockReturnValue({
      status: 'ok',
      applyFriction: true,
      frictionDelayMs: 500,
    });

    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({ id: 'u1' });

    const req = new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'A',
        lastName: 'B',
        email: 'a@example.com',
        password: 'Strong1!a',
      }),
    });

    await POST(req);

    expect(rateLimiterMock.applyBotFriction).toHaveBeenCalledWith(500);
  });
});
