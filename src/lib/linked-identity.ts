/**
 * Institutional identities mapped to AFCT accounts.
 *
 * Accounts stay the unit of identity. An OIDC sign-in or an LMS launch does not create a
 * parallel kind of user; it records that an outside system vouches for someone who has an
 * account here.
 *
 * **The guardrails live in this module, not in its callers.** Sign-in code is written once per
 * provider and copied thereafter, and a rule that depends on every caller remembering it is a
 * rule that will be missed. So the function that creates an automatic link is the function that
 * refuses to create a dangerous one.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import type { IdentityLinkMethod, IdentityProviderKind } from '@prisma/client';

/**
 * Where the request came from, for the audit trail. A `Request` in a route, or a pre-resolved
 * pair where there is none (a sign-in callback, for instance).
 */
export type AuditContext = Request | { ipAddress?: string | null; userAgent?: string | null };

export type { IdentityLinkMethod, IdentityProviderKind };

/** Where an identity came from, as the provider states it. */
export type IdentityRef = {
  kind: IdentityProviderKind;
  /** The provider's own name for itself: an OIDC issuer URL, or an LTI platform issuer. */
  issuer: string;
  /** The provider's stable identifier for the person. Never an email. */
  subject: string;
};

/** Why a link was refused. Callers report these; they are not all the same to a user. */
export type LinkRefusal =
  /** The identity already points at a different account. */
  | 'already-linked-elsewhere'
  /** Automatic linking is never allowed to attach to an administrator. */
  | 'admin-requires-deliberate-link'
  /** The account is disabled, so nothing may be attached to it. */
  | 'account-inactive';

export type LinkResult = { ok: true; created: boolean } | { ok: false; reason: LinkRefusal };

/** The methods that happen without a person deciding, and therefore need the guardrails. */
/**
 * The ways an identity can be attached without anybody deciding to attach it: a trusted address
 * matching an existing account, and an account created on first sign-in. These are the ones an
 * administrator account must never receive, and the ones a promotion removes.
 */
export const AUTOMATIC: IdentityLinkMethod[] = ['AUTO_VERIFIED_EMAIL', 'JUST_IN_TIME'];

/**
 * Find the account an identity signs in as, by issuer and subject.
 *
 * This is the only lookup that should decide who is signing in. Matching on email is how an
 * identity silently moves between accounts when an address is reassigned, which at a university
 * happens every time somebody leaves.
 */
export async function findUserByIdentity(ref: Pick<IdentityRef, 'issuer' | 'subject'>) {
  const link = await prisma.linkedIdentity.findUnique({
    where: { issuer_subject: { issuer: ref.issuer, subject: ref.subject } },
    select: { id: true, userId: true, user: { select: { inactive: true } } },
  });
  return link ?? null;
}

/**
 * Answer a duplicate insert by reading the row that won.
 *
 * Shared by both paths that can hit it: a plain link, which owns its own insert, and the
 * serializable wrapper, whose transaction is dead by the time it sees this. Says what this
 * function would have said had it read the row a moment earlier, and records a refusal the way
 * every other refusal is recorded.
 */
async function settleDuplicate(opts: {
  ref: IdentityRef;
  userId: string;
  via: IdentityLinkMethod;
  actorUserId: string | null;
  context: AuditContext;
  error: unknown;
}): Promise<LinkResult> {
  const { issuer, subject } = opts.ref;
  const settled = await prisma.linkedIdentity.findUnique({
    where: { issuer_subject: { issuer, subject } },
    select: { userId: true },
  });

  // The constraint said the row exists. If it does not, something else is wrong, and answering
  // "already linked" would describe a state that is not there.
  if (!settled) throw opts.error;
  if (settled.userId === opts.userId) return { ok: true, created: false };

  await createEnhancedActivityLog(prisma, opts.context, {
    userId: opts.actorUserId,
    action: 'IDENTITY_LINK_DENIED',
    severity: 'SECURITY',
    category: 'USER',
    metadata: {
      targetUserId: opts.userId,
      issuer,
      via: opts.via,
      reason: 'already-linked-elsewhere',
    },
  });
  return { ok: false, reason: 'already-linked-elsewhere' };
}

/**
 * The automatic path, retried once.
 *
 * A serialization failure here means the account's standing changed while this was deciding,
 * which is exactly the case this exists for. Running it again re-reads that standing and
 * answers on what is true now: an account that has just become an administrator is refused, and
 * an ordinary one is linked.
 *
 * One retry is enough. A second conflict means something is writing to that account
 * continuously, and the honest answer is that this did not get to decide, so the error is
 * rethrown. It used to report `account-inactive`, which is a claim about the account that
 * nothing here established: a conflict can come from a promotion, a deactivation, or another
 * sign-in, and telling somebody their account is disabled when it is not sends them to an
 * administrator for a problem they do not have.
 */
async function linkWithinSerializable(
  opts: Parameters<typeof linkIdentity>[0],
  attempt = 1,
): Promise<LinkResult> {
  const pendingAudit: Parameters<typeof createEnhancedActivityLog>[2][] = [];
  try {
    const result = await prisma.$transaction(
      async (tx) => linkIdentity({ ...opts, tx, pendingAudit }),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Committed, so what it decided actually happened and is worth recording.
    for (const entry of pendingAudit) {
      await createEnhancedActivityLog(prisma, opts.context, entry);
    }
    return result;
  } catch (error) {
    // The duplicate this transaction could not recover from itself: its own statement failed,
    // so the read has to happen out here.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return settleDuplicate({ ...opts, error });
    }

    const conflict =
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') ||
      (error instanceof Error && error.message.includes('TransactionWriteConflict'));
    if (!conflict) throw error;
    if (attempt >= 2) throw error;
    return linkWithinSerializable(opts, attempt + 1);
  }
}

/**
 * Attach an identity to an account.
 *
 * Refuses, rather than throws, for the three cases a caller has to tell a person about:
 *
 *   - **The identity already belongs to another account.** Moving it would hand one person's
 *     work to another, so it needs somebody to look at it.
 *   - **The target is an administrator and the link is automatic.** An admin links their own
 *     identity deliberately. Without this, a provider that lets people choose their own email
 *     address is a path to an administrator account, which is the worst outcome available here.
 *   - **The account is disabled.** Somebody switched it off; attaching a new way in would
 *     quietly undo that.
 *
 * Idempotent: linking an identity that already points at this account succeeds and reports
 * `created: false`, so a repeated sign-in is not an error.
 */
export async function linkIdentity(opts: {
  ref: IdentityRef;
  userId: string;
  via: IdentityLinkMethod;
  /**
   * Who performed the link. Required rather than defaulted to `userId`, so an admin attaching
   * an identity to somebody else's account is logged as the actor. See the activity-log rules.
   *
   * Null when AFCT itself did it with nobody asking, which today means a grade fell due for a
   * student who had never launched and the LMS roster was consulted to find them. Recording a
   * person there would name somebody who did not do it.
   */
  actorUserId: string | null;
  context: AuditContext;
  tx?: Prisma.TransactionClient;
  /**
   * Where to put the audit entry instead of writing it now.
   *
   * A log written inside a transaction that then rolls back describes something that did not
   * happen: the automatic path retries on a serialization conflict, and without this an
   * abandoned attempt would leave "identity linked" in the record with no identity behind it.
   * The caller writes these once the transaction has committed.
   */
  pendingAudit?: Parameters<typeof createEnhancedActivityLog>[2][];
}): Promise<LinkResult> {
  /**
   * An automatic link reads the account's standing and then writes, and the two have to be one
   * decision.
   *
   * Between them, an administrator can be promoted: the read says "ordinary account", the
   * promotion commits, and the insert lands on an account that is an administrator by the time
   * it exists. "Administrators are never attached automatically" would then mean "not if they
   * were administrators a moment ago", which is not the rule.
   *
   * Serializable makes the pair conflict, but only against another serializable transaction, so
   * the promotion path is serializable too (see the user update route). Deliberate links do not
   * need this: somebody is choosing, and the guardrail they cross is their own permission.
   *
   * Skipped when a caller supplies its own transaction: nesting is not available, and the
   * caller has already chosen its isolation.
   */
  if (!opts.tx && AUTOMATIC.includes(opts.via)) {
    return linkWithinSerializable(opts);
  }

  const client = opts.tx ?? prisma;
  const { issuer, subject, kind } = opts.ref;

  const [existing, user] = await Promise.all([
    client.linkedIdentity.findUnique({
      where: { issuer_subject: { issuer, subject } },
      select: { userId: true },
    }),
    client.user.findUnique({
      where: { id: opts.userId },
      select: { isAdmin: true, inactive: true },
    }),
  ]);

  // A refusal is a security event, not a validation error: each one is an attempt to attach a
  // sign-in to an account it should not reach. `_DENIED` also classifies as SECURITY by the
  // action-naming convention, so the two agree.
  const audit = async (entry: Parameters<typeof createEnhancedActivityLog>[2]) => {
    if (opts.pendingAudit) {
      opts.pendingAudit.push(entry);
      return;
    }
    await createEnhancedActivityLog(prisma, opts.context, entry);
  };

  const refuse = async (reason: LinkRefusal): Promise<LinkResult> => {
    await audit({
      userId: opts.actorUserId,
      action: 'IDENTITY_LINK_DENIED',
      severity: 'SECURITY',
      category: 'USER',
      metadata: { targetUserId: opts.userId, issuer, via: opts.via, reason },
    });
    return { ok: false, reason };
  };

  if (!user || user.inactive) return refuse('account-inactive');

  if (existing) {
    if (existing.userId !== opts.userId) return refuse('already-linked-elsewhere');
    // Already ours: a repeated sign-in, not a change worth a log entry of its own.
    return { ok: true, created: false };
  }

  if (user.isAdmin && AUTOMATIC.includes(opts.via)) {
    return refuse('admin-requires-deliberate-link');
  }

  try {
    await client.linkedIdentity.create({
      data: { kind, issuer, subject, userId: opts.userId, linkedVia: opts.via },
    });
  } catch (error) {
    /**
     * Another request attached this identity while this one was deciding to.
     *
     * Two sign-ins for the same person arrive together often enough to matter: a link opened
     * twice, a double-clicked button, a launch and a sign-in side by side. Both read nothing,
     * both create, and the loser used to reach the browser as a failed sign-in for an identity
     * that had in fact just been attached correctly.
     *
     * Settled by reading the row the winner wrote and answering as this function would have
     * answered had it read it a moment earlier: ours is a repeat, somebody else's is a refusal.
     * Nothing new is decided here, which is what makes it safe after the fact.
     */
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }

    /**
     * Not recoverable inside somebody else's transaction: Postgres has already aborted it, so
     * a read here would fail too. The caller owning the transaction owns the recovery, which
     * for the automatic path is the serializable wrapper above.
     */
    if (opts.tx) throw error;

    return settleDuplicate({ ...opts, error });
  }

  // Linking changes who can sign in as this account, and for a student account that is who can
  // reach their records. The subject is recorded because it, with the issuer, is the identity;
  // no other identifying detail from the provider is.
  await audit({
    userId: opts.actorUserId,
    action: 'IDENTITY_LINKED',
    severity: 'INFO',
    category: 'USER',
    metadata: { targetUserId: opts.userId, issuer, subject, kind, via: opts.via },
  });

  return { ok: true, created: true };
}

/** Every identity attached to an account, for the account page and for an admin looking at one. */
export async function listIdentitiesForUser(userId: string) {
  return prisma.linkedIdentity.findMany({
    where: { userId },
    select: {
      id: true,
      kind: true,
      issuer: true,
      subject: true,
      linkedVia: true,
      createdAt: true,
      lastSignInAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Detach an identity from an account.
 *
 * Scoped to the owning account on purpose: a caller passing an id it does not own removes
 * nothing rather than removing someone else's sign-in. Returns whether anything was removed.
 *
 * Deliberately does NOT decide whether the person will still be able to sign in afterwards.
 * That depends on whether they have a local password and on what else is attached, which is a
 * question for the surface doing the unlinking, where it can offer to set one.
 */
export type UnlinkOutcome = 'removed' | 'not-found' | 'last-way-in';

/**
 * A serializable transaction that lost, however the layer beneath happens to spell it.
 *
 * Exported because the sign-in surfaces need it too: an automatic link that conflicts twice
 * rethrows, and a launch or a callback has to tell that transient case apart from a real fault
 * so it can say "try again" instead of showing an error with nothing to act on.
 */
export function isWriteConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return true;
  const name = error instanceof Error ? error.message : String(error);
  return name.includes('TransactionWriteConflict') || name.includes('could not serialize');
}

export async function unlinkIdentity(opts: {
  id: string;
  userId: string;
  actorUserId: string;
  context: AuditContext;
}): Promise<UnlinkOutcome> {
  /**
   * Nobody is left with no way to sign in, and the check cannot be raced.
   *
   * The rule was enforced by the callers: read the password, count the identities, refuse if
   * there was one left, then delete separately. Two requests removing different identities at
   * the same moment both saw two and both deleted, and the account was left with no password
   * and no identity, which nobody can recover without an administrator. Serializable so the
   * count and the delete are one decision, and here rather than in each route so the two ways
   * of removing an identity (a person's own page, an administrator's) cannot drift apart.
   */
  const outcome = await prisma
    .$transaction(
      async (tx) => {
        const owner = await tx.user.findUnique({
          where: { id: opts.userId },
          select: { password: true },
        });
        const remaining = await tx.linkedIdentity.count({ where: { userId: opts.userId } });

        if (!owner?.password && remaining <= 1) return { result: 'last-way-in' as const };

        // Read before the delete, inside the same transaction: the audit entry should say
        // which way in was taken away, and afterwards there is no row left to ask.
        const identity = await tx.linkedIdentity.findFirst({
          where: { id: opts.id, userId: opts.userId },
          select: { issuer: true, kind: true },
        });

        const { count } = await tx.linkedIdentity.deleteMany({
          where: { id: opts.id, userId: opts.userId },
        });
        if (count === 0) return { result: 'not-found' as const };
        return {
          result: 'removed' as const,
          issuer: identity?.issuer ?? null,
          kind: identity?.kind ?? null,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )
    .catch((error: unknown) => {
      /**
       * The loser of a serialization conflict tried to remove an identity at the same moment as
       * another request. Answering as the rule would have answered is exactly right: had it run
       * a moment later, it would have been removing the last way in.
       *
       * Matched on both spellings. Prisma raises `P2034` for a write conflict, and the pg driver
       * adapter this deployment uses reports the same Postgres failure as a
       * `TransactionWriteConflict` before Prisma maps it, which a check for the code alone
       * misses entirely.
       */
      if (isWriteConflict(error)) return { result: 'last-way-in' as const };
      throw error;
    });

  if (outcome.result !== 'removed') return outcome.result;

  await createEnhancedActivityLog(prisma, opts.context, {
    userId: opts.actorUserId,
    action: 'IDENTITY_UNLINKED',
    severity: 'INFO',
    category: 'USER',
    metadata: {
      targetUserId: opts.userId,
      identityId: opts.id,
      issuer: outcome.issuer,
      kind: outcome.kind,
    },
  });
  return 'removed';
}

/**
 * Note that an identity was just used. Best-effort: a failure here must never fail a sign-in
 * that has otherwise succeeded.
 */
export async function recordIdentitySignIn(id: string): Promise<void> {
  try {
    await prisma.linkedIdentity.update({ where: { id }, data: { lastSignInAt: new Date() } });
  } catch (error) {
    console.error('[linked-identity] could not record sign-in:', error);
  }
}
