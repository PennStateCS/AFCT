import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  ltiPendingIdentityLink: { findFirst: vi.fn(), delete: vi.fn() },
}));
const verifyCredentialsMock = vi.hoisted(() => vi.fn());
const linkIdentityMock = vi.hoisted(() => vi.fn());
const issueTokenMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/credentials', () => ({ verifyCredentials: verifyCredentialsMock }));
vi.mock('@/lib/linked-identity', () => ({ linkIdentity: linkIdentityMock }));
vi.mock('@/lib/single-use-token', () => ({ issueSingleUseToken: issueTokenMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('@/lib/lti/public-url', () => ({
  publicUrl: (path: string) => `https://afct.example.edu${path}`,
}));
vi.mock('@/lib/ip-utils', () => ({ getClientIp: () => '198.51.100.7' }));

import { POST } from './route';

const PENDING = {
  id: 'pending-1',
  issuer: 'https://canvas.instructure.com',
  subject: 'lms-user-3',
  userId: 'admin-1',
  next: '/dashboard/courses/c1',
  user: { email: 'admin@example.edu' },
};

const post = (fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return POST(new Request('https://internal/api/lti/confirm-identity', { method: 'POST', body }));
};

const location = (res: Response) => new URL(res.headers.get('location') ?? '', 'https://x');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.ltiPendingIdentityLink.findFirst.mockResolvedValue(PENDING);
  verifyCredentialsMock.mockResolvedValue({ ok: true, user: { id: 'admin-1' } });
  linkIdentityMock.mockResolvedValue({ ok: true, created: true });
  issueTokenMock.mockResolvedValue({ token: 'tkt-1' });
});

describe('confirming an administrator identity', () => {
  it('checks the password through the same path the login form uses', async () => {
    // Which is what gives this rate limiting, lockout and the bot challenge. Comparing a hash
    // here instead would be an unthrottled password oracle that also names administrators.
    await post({ pendingId: 'pending-1', password: 'hunter2' });

    expect(verifyCredentialsMock).toHaveBeenCalledWith({
      email: 'admin@example.edu',
      password: 'hunter2',
      ipAddress: '198.51.100.7',
    });
  });

  it('attaches the identity the launch signed, not anything from the form', async () => {
    await post({ pendingId: 'pending-1', password: 'hunter2', subject: 'attacker-supplied' });

    expect(linkIdentityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: { kind: 'LTI', issuer: PENDING.issuer, subject: 'lms-user-3' },
        userId: 'admin-1',
        // Deliberate, which is exactly what the administrator guardrail asks for.
        via: 'SELF_SERVICE',
      }),
    );
  });

  it('sends them on with a session ticket, to where the launch was going', async () => {
    const res = await post({ pendingId: 'pending-1', password: 'hunter2' });

    expect(res.status).toBe(303);
    const to = location(res);
    expect(to.pathname).toBe('/lti/complete');
    expect(to.searchParams.get('ticket')).toBe('tkt-1');
    expect(to.searchParams.get('next')).toBe('/dashboard/courses/c1');
  });

  it('records it as a security event, because an admin account gained a sign-in', async () => {
    await post({ pendingId: 'pending-1', password: 'hunter2' });

    expect(activityLogMock).toHaveBeenCalledWith(
      prismaMock,
      expect.anything(),
      expect.objectContaining({
        action: 'LTI_ADMIN_IDENTITY_CONFIRMED',
        severity: 'SECURITY',
      }),
    );
  });

  it('spends the confirmation, so it cannot be replayed', async () => {
    await post({ pendingId: 'pending-1', password: 'hunter2' });

    expect(prismaMock.ltiPendingIdentityLink.delete).toHaveBeenCalledWith({
      where: { id: 'pending-1' },
    });
  });

  describe('what it refuses', () => {
    it('sends a wrong password back to the form and links nothing', async () => {
      verifyCredentialsMock.mockResolvedValue({ ok: false, reason: 'invalid' });

      const res = await post({ pendingId: 'pending-1', password: 'wrong' });

      expect(linkIdentityMock).not.toHaveBeenCalled();
      expect(issueTokenMock).not.toHaveBeenCalled();
      expect(location(res).searchParams.get('error')).toBe('1');
    });

    it('says the same thing for a rate-limited attempt as for a wrong one', async () => {
      // This page is reachable by anyone holding a launch, so it must not report which part
      // failed, or it becomes a way to enumerate accounts and their state.
      verifyCredentialsMock.mockResolvedValue({ ok: false, reason: 'rate_limited' });

      const res = await post({ pendingId: 'pending-1', password: 'wrong' });

      expect(location(res).searchParams.get('error')).toBe('1');
    });

    it('will not accept a password that belongs to a different account', async () => {
      verifyCredentialsMock.mockResolvedValue({ ok: true, user: { id: 'somebody-else' } });

      const res = await post({ pendingId: 'pending-1', password: 'their-password' });

      expect(linkIdentityMock).not.toHaveBeenCalled();
      expect(location(res).searchParams.get('error')).toBe('1');
    });

    it('does nothing for an expired or unknown confirmation', async () => {
      prismaMock.ltiPendingIdentityLink.findFirst.mockResolvedValue(null);

      const res = await post({ pendingId: 'gone', password: 'hunter2' });

      expect(verifyCredentialsMock).not.toHaveBeenCalled();
      expect(res.status).toBe(303);
      expect(location(res).searchParams.get('error')).toBeNull();
    });

    it('issues no ticket when the link itself is refused', async () => {
      linkIdentityMock.mockResolvedValue({ ok: false, reason: 'already-linked-elsewhere' });

      const res = await post({ pendingId: 'pending-1', password: 'hunter2' });

      expect(issueTokenMock).not.toHaveBeenCalled();
      expect(location(res).searchParams.get('error')).toBe('1');
    });
  });
});
