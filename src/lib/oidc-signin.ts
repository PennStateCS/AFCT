/**
 * Deciding which AFCT account an institutional sign-in belongs to.
 *
 * Kept apart from the NextAuth wiring because every rule that matters is here, and none of them
 * needs a provider, a request or a session to test. The wiring calls this and does what it says.
 *
 * The order is the point:
 *
 *   1. **A known identity wins.** Issuer plus subject is the durable key, so somebody whose
 *      address changed is still themselves.
 *   2. **Otherwise match on a trusted email**, and attach the identity so step 1 answers next
 *      time. Email is used exactly once, here, and never again for that person.
 *   3. **Otherwise create an account**, which is what makes a first sign-in work at all.
 *
 * "Trusted" means the provider asserted the address as verified, or an administrator has said
 * this provider's addresses can be believed. Without that, neither 2 nor 3 may happen: matching
 * on an unverified address hands over an existing account, and *creating* on one lets somebody
 * squat an address before its owner ever arrives, which is the same takeover a step later.
 */

import { prisma } from '@/lib/prisma';
import { linkIdentity, findUserByIdentity, recordIdentitySignIn } from '@/lib/linked-identity';
import type { AuditContext } from '@/lib/linked-identity';

/** What the provider told us about the person signing in. */
export type OidcClaims = {
  issuer: string;
  /** The provider's stable identifier (`sub`). */
  subject: string;
  email?: string | null;
  /** Whether the provider asserts the address is verified. */
  emailVerified?: boolean;
  firstName?: string | null;
  lastName?: string | null;
};

export type SignInRefusal =
  /** The provider sent no address, so there is nothing to match or create against. */
  | 'no-email'
  /** The address is not one we are allowed to believe. */
  | 'email-not-verified'
  /** The account exists but has been switched off. */
  | 'account-inactive'
  /** An administrator account, which is never attached automatically. */
  | 'admin-requires-deliberate-link'
  /** The identity is already attached to a different account. */
  | 'already-linked-elsewhere';

export type SignInOutcome =
  | { ok: true; userId: string; created: boolean }
  | { ok: false; reason: SignInRefusal };

export async function resolveOidcSignIn(opts: {
  claims: OidcClaims;
  /** Whether an administrator has said this provider's addresses can be believed. */
  trustEmail: boolean;
  context: AuditContext;
}): Promise<SignInOutcome> {
  const { claims, trustEmail, context } = opts;
  const ref = { kind: 'OIDC' as const, issuer: claims.issuer, subject: claims.subject };

  // 1. A known identity. Nothing about the email matters here: this person has signed in before
  //    and we already decided who they are.
  const existing = await findUserByIdentity(ref);
  if (existing) {
    if (existing.user?.inactive) return { ok: false, reason: 'account-inactive' };
    await recordIdentitySignIn(existing.id);
    return { ok: true, userId: existing.userId, created: false };
  }

  const email = claims.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: 'no-email' };
  if (!claims.emailVerified && !trustEmail) return { ok: false, reason: 'email-not-verified' };

  // 2. An existing account with that address. `linkIdentity` holds the guardrails, including
  //    the one that refuses to attach automatically to an administrator.
  const match = await prisma.user.findUnique({
    where: { email },
    select: { id: true, inactive: true },
  });

  if (match) {
    if (match.inactive) return { ok: false, reason: 'account-inactive' };

    const linked = await linkIdentity({
      ref,
      userId: match.id,
      via: 'AUTO_VERIFIED_EMAIL',
      actorUserId: match.id,
      context,
    });
    if (!linked.ok) {
      return {
        ok: false,
        reason:
          linked.reason === 'already-linked-elsewhere'
            ? 'already-linked-elsewhere'
            : linked.reason === 'admin-requires-deliberate-link'
              ? 'admin-requires-deliberate-link'
              : 'account-inactive',
      };
    }
    return { ok: true, userId: match.id, created: false };
  }

  // 3. Nobody here yet. Create the account and attach the identity in one transaction, so a
  //    failure cannot leave an account nobody can sign in to.
  const userId = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        firstName: claims.firstName ?? null,
        lastName: claims.lastName ?? null,
        // No local password. This account exists because a provider vouched for it, and
        // `User.password` is optional for exactly this case.
        password: null,
      },
      select: { id: true },
    });
    await tx.linkedIdentity.create({
      data: { ...ref, userId: created.id, linkedVia: 'JUST_IN_TIME' },
    });
    return created.id;
  });

  // Logged outside the transaction: the audit write must not be able to roll the account back,
  // and a person who exists without a log entry is better than one who does not exist at all.
  await linkIdentityAudit(userId, ref, context);

  return { ok: true, userId, created: true };
}

/**
 * The audit entry for an account created by a sign-in.
 *
 * `linkIdentity` writes its own, but the just-in-time path creates the link inside the
 * transaction rather than through it, so the entry is written here instead.
 */
async function linkIdentityAudit(
  userId: string,
  ref: { issuer: string; subject: string; kind: 'OIDC' },
  context: AuditContext,
): Promise<void> {
  const { createEnhancedActivityLog } = await import('@/lib/activity-log-utils');
  await createEnhancedActivityLog(prisma, context, {
    userId,
    action: 'IDENTITY_LINKED',
    severity: 'INFO',
    category: 'USER',
    metadata: {
      targetUserId: userId,
      issuer: ref.issuer,
      subject: ref.subject,
      kind: ref.kind,
      via: 'JUST_IN_TIME',
      accountCreated: true,
    },
  });
}

/** What to tell somebody who could not be signed in. Never says whether an account exists. */
export function refusalMessage(reason: SignInRefusal): string {
  switch (reason) {
    case 'no-email':
      return 'Your institution did not share an email address with AFCT, so we cannot sign you in. Ask an administrator to check the sign-in settings.';
    case 'email-not-verified':
      return 'Your institution did not confirm your email address. Ask an administrator to check the sign-in settings.';
    case 'admin-requires-deliberate-link':
      return 'This account is an administrator account and must be connected from inside AFCT. Sign in with your AFCT password, then connect your institution from your account page.';
    case 'already-linked-elsewhere':
      return 'That institutional login is already connected to a different AFCT account. Ask an administrator for help.';
    case 'account-inactive':
    default:
      return 'You cannot sign in at the moment. Ask an administrator for help.';
  }
}
