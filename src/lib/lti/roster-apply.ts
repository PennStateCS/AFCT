/**
 * Applying an LMS roster to an AFCT course.
 *
 * Only ever runs on a diff a person has looked at. Every change is one somebody approved, and
 * the whole set is applied together so a failure halfway through cannot leave a course with
 * some students enrolled and others not.
 *
 * Creating an account here is deliberate and safe in a way it would not be elsewhere: the
 * address comes from the institution's own LMS over an authenticated service call, not from
 * anything a person typed.
 */

import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import type { AuditContext } from '@/lib/linked-identity';
import type { RosterChange } from '@/lib/lti/roster-diff';

export type ApplyResult = {
  added: number;
  dropped: number;
  restored: number;
  identitiesLinked: number;
  accountsCreated: number;
};

/**
 * Apply the approved changes.
 *
 * Anything already true is left alone, so applying the same diff twice is harmless: rosters get
 * synced repeatedly and a second run should be a no-op rather than a second set of changes.
 */
export async function applyRosterChanges(opts: {
  courseId: string;
  issuer: string;
  changes: RosterChange[];
  actorUserId: string;
  context: AuditContext;
}): Promise<ApplyResult> {
  const { courseId, issuer, changes, actorUserId } = opts;
  const result: ApplyResult = {
    added: 0,
    dropped: 0,
    restored: 0,
    identitiesLinked: 0,
    accountsCreated: 0,
  };

  /**
   * One entry per person, written after the roster is committed.
   *
   * Counts alone cannot answer "was this student dropped, and when", which is the question both
   * a support request and a FERPA disclosure record turn on. These use the same actions as a
   * roster change made by hand, so a drop reads the same however it happened, with the source
   * in the metadata.
   */
  const events: { action: string; targetUserId: string; extra?: Record<string, unknown> }[] = [];

  await prisma.$transaction(async (tx) => {
    for (const change of changes) {
      switch (change.kind) {
        case 'add': {
          const userId =
            change.existingUserId ??
            (await createAccount(tx, change, () => result.accountsCreated++));

          await tx.roster.upsert({
            where: { courseId_userId: { courseId, userId } },
            create: { courseId, userId, role: change.role },
            // Already there: re-enrol rather than change a role somebody set here on purpose.
            update: { status: 'ENROLLED' },
          });
          await ensureIdentity(tx, { userId, issuer, subject: change.member.ltiUserId }, () => {
            result.identitiesLinked++;
            events.push({
              action: 'IDENTITY_LINKED',
              targetUserId: userId,
              extra: { kind: 'LTI', issuer, subject: change.member.ltiUserId, via: 'ADMIN' },
            });
          });
          events.push({
            action: 'ENROLL_USER',
            targetUserId: userId,
            extra: { role: change.role, email: change.member.email },
          });
          result.added++;
          break;
        }

        case 'drop': {
          // Dropped, not deleted: the record and their work stay.
          await tx.roster.updateMany({
            where: { courseId, userId: change.userId, status: 'ENROLLED' },
            data: { status: 'DROPPED', droppedAt: new Date() },
          });
          events.push({ action: 'DROP_FROM_COURSE', targetUserId: change.userId });
          result.dropped++;
          break;
        }

        case 'restore': {
          await tx.roster.updateMany({
            where: { courseId, userId: change.userId },
            data: { status: 'ENROLLED', droppedAt: null },
          });
          events.push({ action: 'REENROLL_IN_COURSE', targetUserId: change.userId });
          result.restored++;
          break;
        }

        case 'link-identity': {
          await ensureIdentity(
            tx,
            { userId: change.userId, issuer, subject: change.ltiUserId },
            () => {
              result.identitiesLinked++;
              events.push({
                action: 'IDENTITY_LINKED',
                targetUserId: change.userId,
                extra: { kind: 'LTI', issuer, subject: change.ltiUserId, via: 'ADMIN' },
              });
            },
          );
          break;
        }
      }
    }
  });

  // All outside the transaction: an audit write must not be able to roll a roster back, and
  // this is a privileged change to who can see student work, so it is recorded whatever else
  // happens.
  for (const event of events) {
    await createEnhancedActivityLog(prisma, opts.context, {
      userId: actorUserId,
      courseId,
      action: event.action,
      severity: 'INFO',
      category: 'COURSE',
      // `via` marks it as a sync rather than somebody working through the roster by hand.
      metadata: { targetUserId: event.targetUserId, via: 'LTI_ROSTER_SYNC', ...event.extra },
    });
  }

  await createEnhancedActivityLog(prisma, opts.context, {
    userId: actorUserId,
    courseId,
    action: 'LTI_ROSTER_SYNCED',
    severity: 'WARNING',
    category: 'COURSE',
    metadata: { ...result, issuer },
  });

  return result;
}

/** An account for somebody the institution's LMS lists and AFCT has never seen. */
async function createAccount(
  tx: Prisma.TransactionClient,
  change: Extract<RosterChange, { kind: 'add' }>,
  onCreated: () => void,
): Promise<string> {
  const email = change.member.email;
  // Without an address there is nothing to create an account against, and no way for them to
  // ever sign in another way. The diff should not have offered this, so it is a bug if hit.
  if (!email) throw new Error('cannot create an account with no email address');

  const created = await tx.user.create({
    data: {
      email,
      firstName: change.member.firstName,
      lastName: change.member.lastName,
      // No password: this account exists because an LMS vouched for it.
      password: null,
    },
    select: { id: true },
  });
  onCreated();
  return created.id;
}

/**
 * Attach the LMS identity, which is what lets a grade be sent for this person.
 *
 * Written directly rather than through `linkIdentity` because it runs inside the transaction,
 * and because the guardrails there are about a person signing in. Nobody is being signed in
 * here; an administrator is applying a roster they have read.
 */
async function ensureIdentity(
  tx: Prisma.TransactionClient,
  ref: { userId: string; issuer: string; subject: string },
  onLinked: () => void,
): Promise<void> {
  const existing = await tx.linkedIdentity.findUnique({
    where: { issuer_subject: { issuer: ref.issuer, subject: ref.subject } },
    select: { userId: true },
  });

  // Already attached, possibly to somebody else. Leaving it alone is right either way: moving
  // an identity between accounts is not something a roster sync should decide.
  if (existing) return;

  await tx.linkedIdentity.create({
    data: {
      userId: ref.userId,
      kind: 'LTI',
      issuer: ref.issuer,
      subject: ref.subject,
      linkedVia: 'ADMIN',
    },
  });
  onLinked();
}
