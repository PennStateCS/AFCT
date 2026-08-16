/**
 * Finding a student's LMS identity when they have never launched AFCT.
 *
 * A grade is addressed to the LMS's own id for a person, which AFCT normally learns when they
 * open AFCT from the LMS. Plenty of students never do: they reach AFCT directly, do the work,
 * and the grade falls due before they have ever clicked the link in their LMS. Until now that
 * grade could not be sent at all, and the instructor was told the student "has not opened AFCT
 * from your LMS yet", which is true, unhelpful, and not something either of them can fix in
 * time.
 *
 * The platform already knows. Names and Role Provisioning is the standard way to ask it, AFCT
 * is registered for that scope for the roster sync, and the answer includes each member's LMS
 * id alongside the email the platform vouches for. So rather than refusing, ask.
 *
 * Matching is by email and nothing else. Names repeat within a course and are not identifiers;
 * an email is what the platform asserts and what AFCT already trusts to sign somebody in on a
 * launch. A match must be unique and the member must be active, or nothing is linked: putting
 * one student's grade in another's row is far worse than a grade that has to wait.
 */

import { prisma } from '@/lib/prisma';
import { fetchMembership } from '@/lib/lti/nrps';
import { linkIdentity } from '@/lib/linked-identity';
import type { LinkRefusal } from '@/lib/linked-identity';

export type ResolveOutcome =
  /** Linked, and the LMS id to post the grade against. */
  | { ok: true; ltiUserId: string }
  /** The platform could not be asked. Worth trying again later. */
  | { ok: false; retryable: true; reason: 'unreachable' }
  /** The platform answered and this person is not in it, or not identifiable. */
  | { ok: false; retryable: false; reason: 'not-in-roster' | 'no-email' | 'ambiguous' }
  /** The identity was found but may not be attached to this account. */
  | { ok: false; retryable: false; reason: 'link-refused'; detail: LinkRefusal };

/**
 * Ask the LMS who this AFCT user is, and remember the answer.
 *
 * Writes both records a launch would have written: the identity link, so any future grade goes
 * straight through, and the context membership, so a cross-listed course still knows which
 * section the student is in.
 */
export async function resolveIdentityFromRoster(opts: {
  userId: string;
  link: {
    id: string;
    contextId: string;
    membershipsUrl: string | null;
    platform: { id: string; clientId: string; tokenUrl: string; issuer: string };
  };
}): Promise<ResolveOutcome> {
  const user = await prisma.user.findUnique({
    where: { id: opts.userId },
    select: { id: true, email: true },
  });
  const email = user?.email?.trim().toLowerCase();
  if (!email) return { ok: false, retryable: false, reason: 'no-email' };

  const roster = await fetchMembership({
    platform: opts.link.platform,
    membershipsUrl: opts.link.membershipsUrl,
  });
  if (!roster.ok) {
    // `no-endpoint` means the platform never granted the scope, which no amount of retrying
    // fixes; the rest are the platform being unreachable, slow, or paging oddly.
    const retryable = roster.reason !== 'no-endpoint';
    return retryable
      ? { ok: false, retryable: true, reason: 'unreachable' }
      : { ok: false, retryable: false, reason: 'not-in-roster' };
  }

  const matches = roster.members.filter(
    (member) => member.active && member.email?.trim().toLowerCase() === email,
  );
  if (matches.length === 0) return { ok: false, retryable: false, reason: 'not-in-roster' };
  // Two active members sharing an email is a mess in the LMS, not something to resolve by
  // picking one. Refusing leaves a grade queued; guessing puts it on the wrong person.
  if (matches.length > 1) return { ok: false, retryable: false, reason: 'ambiguous' };

  const subject = matches[0]!.ltiUserId;

  /**
   * Attached through the shared helper rather than written here, so every rule about who may
   * hold a sign-in is enforced in one place. It refuses an identity that already belongs to
   * another account, an inactive account, and an administrator, and logs both the link and any
   * refusal. That last rule matters most here: this path is driven by an email the LMS asserts,
   * and an AFCT administrator must never be reachable that way.
   *
   * No actor, because there is not one. A grade fell due for somebody who had never launched.
   */
  const linked = await linkIdentity({
    ref: { kind: 'LTI', issuer: opts.link.platform.issuer, subject },
    userId: opts.userId,
    // The enum already describes exactly this: matched to an account by an email the provider
    // asserted as verified.
    via: 'AUTO_VERIFIED_EMAIL',
    actorUserId: null,
    context: {},
  });
  if (!linked.ok) return { ok: false, retryable: false, reason: 'link-refused', detail: linked.reason };

  await prisma.ltiContextMember.upsert({
    where: { contextLinkId_userId: { contextLinkId: opts.link.id, userId: opts.userId } },
    create: { contextLinkId: opts.link.id, userId: opts.userId, ltiUserId: subject },
    update: { ltiUserId: subject },
  });

  return { ok: true, ltiUserId: subject };
}
