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

import { Prisma } from '@prisma/client';
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
  | { ok: true; userId: string; created: boolean }
  /**
   * `userId` is present only for `admin-requires-deliberate-link`, and only so the caller can
   * offer that person a way through: an LTI launch asks for their AFCT password and links the
   * identity deliberately. Naming the account is safe there because the refusal is already
   * telling them an administrator account matched; it is not returned for any other refusal,
   * where saying which account matched would answer a question nobody proved they may ask.
   */
  | { ok: false; reason: SignInRefusal; userId?: string };

/**
 * Who an OIDC or LTI sign-in belongs to, and whether it may proceed.
 *
 * The one place that decides between matching an existing identity, adopting an account by
 * verified email, creating one, and refusing. Every refusal is a named {@link SignInRefusal}
 * rather than a boolean, because the caller has to tell the person what to do next, and the
 * decision is audited here rather than by each caller.
 */
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
      if (linked.reason === 'admin-requires-deliberate-link') {
        return { ok: false, reason: 'admin-requires-deliberate-link', userId: match.id };
      }
      return {
        ok: false,
        reason:
          linked.reason === 'already-linked-elsewhere'
            ? 'already-linked-elsewhere'
            : 'account-inactive',
      };
    }
    return { ok: true, userId: match.id, created: false };
  }

  // 3. Nobody here yet. Create the account and attach the identity in one transaction, so a
  //    failure cannot leave an account nobody can sign in to.
  let userId: string;
  try {
    userId = await prisma.$transaction(async (tx) => {
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
  } catch (error) {
    /**
     * Somebody else created them while this request was deciding to.
     *
     * Two first-time sign-ins for the same person arrive together often enough to matter: a
     * launch and a sign-in in two tabs, or a double-clicked button. Both find nothing, both
     * create, and the unique constraint on the address or on the issuer and subject refuses the
     * second, which used to reach the browser as a failed sign-in for a person whose account
     * had in fact just been made. Re-reading the identity settles it: the row the winner wrote
     * is the answer, and both requests sign in as the same person.
     */
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }

    const settled = await prisma.linkedIdentity.findUnique({
      where: { issuer_subject: { issuer: ref.issuer, subject: ref.subject } },
      select: { userId: true, user: { select: { inactive: true } } },
    });
    if (settled) {
      if (settled.user.inactive) return { ok: false, reason: 'account-inactive' };
      return { ok: true, userId: settled.userId, created: false };
    }

    /**
     * No identity, so the collision was on the address: somebody else created an account with
     * it while this request was deciding to. That happens legitimately when two *different*
     * identities assert the same trusted address, which is two people signing in for the first
     * time from one institution, or one person arriving through two providers.
     *
     * The recovery is the match this request would have made had it arrived a moment later,
     * and it is made the same way: through `linkIdentity`, which holds every guardrail. An
     * administrator is still refused an automatic link, an inactive account is still closed,
     * and an identity already attached elsewhere is still refused. Nothing here decides
     * anything the unraced path would not have decided; refusing instead, as this used to,
     * turned a timing accident into a failed sign-in with no conflict behind it.
     *
     * The address was required to be present and trusted before any of this ran, so re-reading
     * by it is not a new trust decision either.
     */
    const raced = await prisma.user.findUnique({
      where: { email },
      select: { id: true, inactive: true },
    });
    if (!raced) throw error;
    if (raced.inactive) return { ok: false, reason: 'account-inactive' };

    const linked = await linkIdentity({
      ref,
      userId: raced.id,
      via: 'AUTO_VERIFIED_EMAIL',
      actorUserId: raced.id,
      context,
    });
    if (!linked.ok) {
      if (linked.reason === 'admin-requires-deliberate-link') {
        return { ok: false, reason: 'admin-requires-deliberate-link', userId: raced.id };
      }
      return {
        ok: false,
        reason:
          linked.reason === 'already-linked-elsewhere'
            ? 'already-linked-elsewhere'
            : 'account-inactive',
      };
    }
    return { ok: true, userId: raced.id, created: false };
  }

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
