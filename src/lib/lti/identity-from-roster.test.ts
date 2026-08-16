import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  ltiContextMember: { upsert: vi.fn() },
}));
const fetchMembershipMock = vi.hoisted(() => vi.fn());
const linkIdentityMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/lti/nrps', () => ({ fetchMembership: fetchMembershipMock }));
vi.mock('@/lib/linked-identity', () => ({ linkIdentity: linkIdentityMock }));

import { resolveIdentityFromRoster } from '@/lib/lti/identity-from-roster';

const LINK = {
  id: 'link-1',
  contextId: 'ctx-1',
  membershipsUrl: 'https://lms.example.edu/api/lti/courses/1/names_and_roles',
  platform: {
    id: 'plat-1',
    clientId: '10000000000002',
    tokenUrl: 'https://lms.example.edu/login/oauth2/token',
    issuer: 'https://canvas.instructure.com',
  },
};

const member = (over: Partial<Record<string, unknown>> = {}) => ({
  ltiUserId: 'lms-user-9',
  email: 'ada@example.edu',
  firstName: 'Ada',
  lastName: 'Lovelace',
  roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
  active: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'ada@example.edu' });
  linkIdentityMock.mockResolvedValue({ ok: true, created: true });
  fetchMembershipMock.mockResolvedValue({ ok: true, members: [member()] });
});

describe('resolveIdentityFromRoster', () => {
  it('finds the student in the LMS roster and returns the id a grade is posted against', async () => {
    const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

    expect(result).toEqual({ ok: true, ltiUserId: 'lms-user-9' });
  });

  /**
   * Through the shared helper, not around it. Every rule about who may hold a sign-in lives
   * there, including the one that matters most on this path: an email the LMS asserts must
   * never attach an identity to an AFCT administrator.
   */
  it('attaches the identity through the shared linking rules', async () => {
    await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

    expect(linkIdentityMock).toHaveBeenCalledWith({
      ref: { kind: 'LTI', issuer: 'https://canvas.instructure.com', subject: 'lms-user-9' },
      userId: 'u1',
      via: 'AUTO_VERIFIED_EMAIL',
      // Nobody asked for this: a grade fell due for somebody who had never launched.
      actorUserId: null,
      context: {},
    });
  });

  it('reports a refusal rather than writing the link itself', async () => {
    // An administrator account is the case this protects: the helper refuses, and this must
    // not quietly proceed or fall back to its own write.
    linkIdentityMock.mockResolvedValue({ ok: false, reason: 'admin-requires-deliberate-link' });

    const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

    expect(result).toEqual({
      ok: false,
      retryable: false,
      reason: 'link-refused',
      detail: 'admin-requires-deliberate-link',
    });
    expect(prismaMock.ltiContextMember.upsert).not.toHaveBeenCalled();
  });

  it('records which LMS course they are in, which a cross-listed course needs', async () => {
    await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

    expect(prismaMock.ltiContextMember.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { contextLinkId: 'link-1', userId: 'u1', ltiUserId: 'lms-user-9' },
      }),
    );
  });

  it('matches an email whatever case or spacing the LMS uses', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: 'Ada@Example.edu' });
    fetchMembershipMock.mockResolvedValue({ ok: true, members: [member({ email: ' ada@example.edu ' })] });

    const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

    expect(result.ok).toBe(true);
  });

  describe('what it refuses to guess at', () => {
    it('will not match somebody the LMS says is no longer active', async () => {
      fetchMembershipMock.mockResolvedValue({ ok: true, members: [member({ active: false })] });

      const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

      expect(result).toEqual({ ok: false, retryable: false, reason: 'not-in-roster' });
      expect(linkIdentityMock).not.toHaveBeenCalled();
    });

    it('will not pick one of two members sharing an email', async () => {
      // A grade on the wrong student is worse than a grade that waits for somebody to look.
      fetchMembershipMock.mockResolvedValue({
        ok: true,
        members: [member(), member({ ltiUserId: 'lms-user-10' })],
      });

      const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

      expect(result).toEqual({ ok: false, retryable: false, reason: 'ambiguous' });
      expect(linkIdentityMock).not.toHaveBeenCalled();
    });

    it('leaves an identity that already belongs to another account where it is', async () => {
      // The shared helper decides this, and its refusal is passed on rather than reinterpreted.
      linkIdentityMock.mockResolvedValue({ ok: false, reason: 'already-linked-elsewhere' });

      const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

      expect(result).toMatchObject({ ok: false, reason: 'link-refused' });
    });

    it('does nothing when AFCT holds no email to match on', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', email: null });

      const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

      expect(result).toEqual({ ok: false, retryable: false, reason: 'no-email' });
      expect(fetchMembershipMock).not.toHaveBeenCalled();
    });
  });

  describe('when the LMS cannot answer', () => {
    it('asks to be retried when the platform is unreachable', async () => {
      fetchMembershipMock.mockResolvedValue({ ok: false, reason: 'unreachable' });

      const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

      expect(result).toEqual({ ok: false, retryable: true, reason: 'unreachable' });
    });

    it('asks to be retried on a partial roster rather than concluding from it', async () => {
      // An incomplete read is exactly when a student can look absent while being enrolled.
      fetchMembershipMock.mockResolvedValue({ ok: false, reason: 'incomplete' });

      const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.retryable).toBe(true);
    });

    it('gives up when the platform never granted the roster scope', async () => {
      // No amount of waiting adds a permission, and saying so is what gets it fixed.
      fetchMembershipMock.mockResolvedValue({ ok: false, reason: 'no-endpoint' });

      const result = await resolveIdentityFromRoster({ userId: 'u1', link: LINK });

      expect(result).toEqual({ ok: false, retryable: false, reason: 'not-in-roster' });
    });
  });
});
