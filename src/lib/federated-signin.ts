/**
 * Deciding which AFCT account a federated sign-in belongs to. Shared by OIDC and LTI so a
 * security rule cannot be fixed in one path and missed in the other.
 *
 * A known identity wins, then a trusted email once, then a new account. Issuer plus subject is
 * the durable key, so a changed address is still the same person, and email is used exactly
 * once per person and never again.
 *
 * Callers decide whether the email may be trusted, because what makes one trustworthy differs
 * between a public provider and a registered LMS. Without trust neither of the last two steps
 * may run: matching hands over an existing account, and creating lets someone squat an address
 * before its owner arrives.
 */

import { prisma } from '@/lib/prisma';
import { linkIdentity, findUserByIdentity, recordIdentitySignIn } from '@/lib/linked-identity';
import type { AuditContext, IdentityProviderKind } from '@/lib/linked-identity';

export type FederatedClaims = {
  kind: IdentityProviderKind;
  issuer: string;
  /** The provider's stable identifier for this person. Never an email. */
  subject: string;
  email?: string | null;
  /**
   * Whether this address may be believed. Decided by the caller, because what makes an address
   * trustworthy differs between a public OIDC provider and a registered LMS.
   */
  emailTrusted: boolean;
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
  { ok: true; userId: string; created: boolean } | { ok: false; reason: SignInRefusal };

export async function resolveFederatedSignIn(opts: {
  claims: FederatedClaims;
  context: AuditContext;
}): Promise<SignInOutcome> {
  const { claims, context } = opts;
  const ref = { kind: claims.kind, issuer: claims.issuer, subject: claims.subject };

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
  if (!claims.emailTrusted) return { ok: false, reason: 'email-not-verified' };

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
  await auditJustInTimeLink(userId, ref, context);

  return { ok: true, userId, created: true };
}

/**
 * The audit entry for an account created by a sign-in.
 *
 * `linkIdentity` writes its own, but the just-in-time path creates the link inside the
 * transaction rather than through it, so the entry is written here instead.
 */
async function auditJustInTimeLink(
  userId: string,
  ref: { issuer: string; subject: string; kind: IdentityProviderKind },
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
