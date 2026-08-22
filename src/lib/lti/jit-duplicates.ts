import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Finding the account an LMS launch made for somebody who is about to be given a real one.
 *
 * A launch resolves an account by issuer and subject, and that pair is unique. The email is
 * consulted only the first time, to decide which existing account to attach to. That is the
 * right design, because an LMS email is not a stable identifier and re-resolving on one would
 * let a changed address move somebody onto another person's account.
 *
 * The cost is that a first launch made under the wrong conditions is permanent. An instructor
 * who opens the AFCT link before an administrator has created their account gets one made on
 * the spot; when their real account arrives later under the institutional address, every launch
 * still resolves to the first one, which staffs nothing. The account holding their courses is
 * unreachable from the LMS and nothing on either says why.
 *
 * This exists to catch that at the one moment both halves are visible: an administrator typing
 * the name of somebody an LMS has already met.
 */

/**
 * What must be true of an account before its LMS sign-in may be moved.
 *
 * Written once and used twice, in the lookup and again inside the transaction that acts, so the
 * two cannot drift into disagreeing about what is safe.
 *
 * An earlier draft of this used "has no roster row" as the whole test, on the reasoning that
 * submissions need course access. That is wrong, and the ways it is wrong are worth keeping
 * here so the shorter test is not restored:
 *
 *  - Removing somebody from a roster is a hard delete, and it refuses only when they have
 *    **submissions**. A hand-entered grade is written against the student directly, with no
 *    submission behind it, so a manually graded student who was later removed from the course
 *    is an account with no roster row and real grades on it.
 *  - An administrator may act in a course without a roster row at all.
 *  - An account can hold things no roster knows about: a password they set themselves, and a
 *    second identity if they have also signed in through their institution.
 *
 * Client API tokens are deliberately not disqualifying: client auth refuses an inactive account
 * on every request, so retiring the orphan is enough to stop them.
 */
const ADOPTABLE = {
  // Not an administrator, and never disabled: both change what the account can already do.
  isAdmin: false,
  inactive: false,
  // No password of their own. If they set one, the account is theirs and in use.
  password: null,
  // Nothing that would be stranded by moving the sign-in away.
  rosterEntries: { none: {} },
  submissions: { none: {} },
  problemGrades: { none: {} },
  commentsAbout: { none: {} },
  ltiScores: { none: {} },
} satisfies Prisma.UserWhereInput;

/** The launch-made sign-in itself, and the only one the account may have. */
const LAUNCH_IDENTITY = { kind: 'LTI', linkedVia: 'JUST_IN_TIME' } as const;

export type OrphanedLaunchAccount = {
  userId: string;
  email: string;
  identityId: string;
  issuer: string;
  /** When the LMS first signed them in, which is what dates the account for a reader. */
  connectedAt: Date;
};

/**
 * The account an LMS made for this person, if there is exactly one and it is safe to move.
 *
 * Deliberately answers nothing when more than one account matches. Two real people can share a
 * name, and guessing between them is the failure this must never introduce: a silent miss costs
 * an administrator nothing, and a wrong guess costs somebody their coursework.
 */
export async function findOrphanedLaunchAccount(
  opts: { firstName: string; lastName: string },
  db: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<OrphanedLaunchAccount | null> {
  const firstName = opts.firstName.trim();
  const lastName = opts.lastName.trim();
  if (!firstName || !lastName) return null;

  const candidates = await db.user.findMany({
    where: {
      ...ADOPTABLE,
      // Case-insensitive, because an administrator types a name and an LMS sends one.
      firstName: { equals: firstName, mode: 'insensitive' },
      lastName: { equals: lastName, mode: 'insensitive' },
      linkedIdentities: { some: LAUNCH_IDENTITY },
    },
    select: {
      id: true,
      email: true,
      linkedIdentities: {
        select: { id: true, kind: true, linkedVia: true, issuer: true, createdAt: true },
      },
    },
    // Two is all it takes to know the answer is "say nothing".
    take: 2,
  });

  if (candidates.length !== 1) return null;

  const account = candidates[0]!;
  // The launch-made sign-in has to be the ONLY one. A second identity would be stranded on a
  // retired account, and its owner would meet a dead end rather than their new account.
  if (account.linkedIdentities.length !== 1) return null;

  const identity = account.linkedIdentities[0]!;
  if (identity.kind !== LAUNCH_IDENTITY.kind || identity.linkedVia !== LAUNCH_IDENTITY.linkedVia) {
    return null;
  }

  return {
    userId: account.id,
    email: account.email,
    identityId: identity.id,
    issuer: identity.issuer,
    connectedAt: identity.createdAt,
  };
}

/**
 * The same question, asked again about one known account inside the transaction that acts.
 *
 * The warning and the decision are separate requests with a person in between, so anything the
 * predicate cares about can change while they read it. Answering from the earlier lookup would
 * be acting on what used to be true.
 */
export async function readAdoptableAccount(
  userId: string,
  db: PrismaClient | Prisma.TransactionClient,
): Promise<OrphanedLaunchAccount | null> {
  const account = await db.user.findFirst({
    where: { id: userId, ...ADOPTABLE },
    select: {
      id: true,
      email: true,
      linkedIdentities: {
        select: {
          id: true,
          kind: true,
          linkedVia: true,
          issuer: true,
          subject: true,
          createdAt: true,
        },
      },
    },
  });
  if (!account || account.linkedIdentities.length !== 1) return null;

  const identity = account.linkedIdentities[0]!;
  if (identity.kind !== LAUNCH_IDENTITY.kind || identity.linkedVia !== LAUNCH_IDENTITY.linkedVia) {
    return null;
  }

  return {
    userId: account.id,
    email: account.email,
    identityId: identity.id,
    issuer: identity.issuer,
    connectedAt: identity.createdAt,
  };
}
