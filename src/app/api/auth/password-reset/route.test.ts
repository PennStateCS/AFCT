import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  activityLog: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

const logMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: logMock }));

const mailerMock = vi.hoisted(() => ({ canSendPasswordReset: vi.fn() }));
vi.mock('@/lib/mailer', () => mailerMock);

const resetMock = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));
vi.mock('@/lib/password-reset', () => resetMock);

const rateMock = vi.hoisted(() => ({
  getClientIp: vi.fn(() => '10.0.0.1'),
  evaluatePasswordResetRateLimit: vi.fn(() => ({ status: 'ok' })),
}));
vi.mock('@/lib/security/rate-limiter', () => rateMock);

import { POST } from './route';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/auth/password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  mailerMock.canSendPasswordReset.mockResolvedValue({ ok: true });
  resetMock.requestPasswordReset.mockResolvedValue({ sent: true });
  rateMock.evaluatePasswordResetRateLimit.mockReturnValue({ status: 'ok' });
  logMock.mockResolvedValue(undefined);
});

/**
 * The one property this endpoint exists to protect: its answer must never reveal whether an
 * address has an account. At a university that would be a roster nobody agreed to publish, and
 * every branch below has to hold the line, including the ones that fail.
 */
describe('the response never reveals whether the address exists', () => {
  const bodies: string[] = [];
  const capture = async (setup: () => void) => {
    setup();
    const res = await post({ email: 'someone@example.edu' });
    expect(res.status).toBe(200);
    bodies.push(JSON.stringify(await res.json()));
  };

  it('answers identically for a known address, an unknown one, a blocked request and a mail failure', async () => {
    await capture(() => resetMock.requestPasswordReset.mockResolvedValue({ sent: true }));
    await capture(() => resetMock.requestPasswordReset.mockResolvedValue({ sent: false }));
    await capture(() =>
      rateMock.evaluatePasswordResetRateLimit.mockReturnValue({ status: 'blocked' }),
    );
    await capture(() => {
      rateMock.evaluatePasswordResetRateLimit.mockReturnValue({ status: 'ok' });
      resetMock.requestPasswordReset.mockRejectedValue(new Error('smtp down'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    expect(new Set(bodies).size).toBe(1);
  });
});

describe('rate limiting', () => {
  it('does not send when the request is blocked', async () => {
    rateMock.evaluatePasswordResetRateLimit.mockReturnValue({ status: 'blocked' });

    await post({ email: 'someone@example.edu' });

    expect(resetMock.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('limits on the address as well as the caller', async () => {
    await post({ email: 'someone@example.edu' });

    expect(rateMock.evaluatePasswordResetRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ identifier: 'someone@example.edu', ip: '10.0.0.1' }),
    );
  });
});

describe('when the site cannot send email', () => {
  // Not a secret, and more useful than a reassuring message about mail that is never coming.
  it('says so plainly rather than pretending a link is on its way', async () => {
    mailerMock.canSendPasswordReset.mockResolvedValue({ ok: false, reason: 'no mail server' });

    const res = await post({ email: 'someone@example.edu' });

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('administrator'),
    });
  });
});

describe('logging', () => {
  it('records the request and whether a link actually went out', async () => {
    resetMock.requestPasswordReset.mockResolvedValue({ sent: false });

    await post({ email: 'nobody@example.edu' });

    expect(logMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: 'PASSWORD_RESET_REQUESTED',
        metadata: expect.objectContaining({ email: 'nobody@example.edu', queued: false }),
      }),
    );
  });

  it('records a send failure as an error without telling the caller', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resetMock.requestPasswordReset.mockRejectedValue(new Error('smtp down'));

    const res = await post({ email: 'someone@example.edu' });

    expect(res.status).toBe(200);
    expect(logMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: 'PASSWORD_RESET_SEND_FAILED', severity: 'ERROR' }),
    );
  });
});

describe('validation', () => {
  it('rejects something that is not an address', async () => {
    const res = await post({ email: 'not-an-address' });

    expect(res.status).toBe(400);
    expect(resetMock.requestPasswordReset).not.toHaveBeenCalled();
  });
});
