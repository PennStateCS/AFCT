/**
 * The queue of grades on their way to an LMS.
 *
 * Grades are queued when they change and sent afterwards. An LMS that is slow, down or
 * rate-limiting must never make grading fail or hang, and a grade that did not arrive has to be
 * visible rather than lost in a log.
 */

import { prisma } from '@/lib/prisma';
import type { LtiScoreState } from '@prisma/client';

/** Give up after this many tries and leave it for somebody to look at. */
export const MAX_ATTEMPTS = 6;

/** Backoff between attempts, in minutes: about a day in total before giving up. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 480];

/**
 * Queue a grade, replacing whatever was already waiting for that student.
 *
 * A regrade should send the current grade, not a history of edits, so this overwrites rather
 * than appending. Resets the attempt count too: a new grade deserves a fresh run at it, even if
 * the previous one had exhausted its retries.
 */
export async function queueScore(opts: {
  assignmentId: string;
  userId: string;
  scoreGiven: number;
  scoreMaximum: number;
}): Promise<void> {
  const fields = {
    scoreGiven: opts.scoreGiven,
    scoreMaximum: opts.scoreMaximum,
    state: 'PENDING' as LtiScoreState,
    attempts: 0,
    lastError: null,
    nextAttemptAt: new Date(),
    sentAt: null,
  };

  await prisma.ltiScoreQueue.upsert({
    where: { assignmentId_userId: { assignmentId: opts.assignmentId, userId: opts.userId } },
    create: { assignmentId: opts.assignmentId, userId: opts.userId, ...fields },
    update: fields,
  });
}

/**
 * How long a claim holds a grade before another sender may take it.
 *
 * Doubles as crash recovery: a sender that dies mid-send leaves the row claimed, and this is how
 * long before somebody picks it up again. Long enough for a slow LMS to answer, short enough
 * that a grade is not stranded.
 */
const CLAIM_LEASE_MS = 5 * 60 * 1000;

/**
 * Take the next grade to send, reserving it.
 *
 * The comment here used to say that bumping `attempts` stopped two senders taking the same row.
 * It does not: the row stays `PENDING` and still due, so a second caller reads it, sees the new
 * attempt count, and claims it too. Only a genuinely simultaneous pair of reads collides on the
 * old guard. The lease is what makes this exclusive, by moving the row out of the due window
 * while it is being worked on.
 *
 * Nothing could trigger it when this was written: one loop per process, one process, and the
 * "Send grades now" button only queues. But two senders claiming one grade would both call
 * `ensureLineItem`, and two of those racing can each create a gradebook column, which is the
 * duplicate this file exists to avoid.
 */
export async function claimNextScore(now = new Date()) {
  const candidate = await prisma.ltiScoreQueue.findFirst({
    where: { state: 'PENDING', nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: 'asc' },
    select: { id: true, attempts: true },
  });
  if (!candidate) return null;

  const { count } = await prisma.ltiScoreQueue.updateMany({
    // Both guards matter: `attempts` catches a simultaneous claim, and `nextAttemptAt` is what
    // the winner moves, so a loser arriving afterwards matches nothing.
    where: {
      id: candidate.id,
      state: 'PENDING',
      attempts: candidate.attempts,
      nextAttemptAt: { lte: now },
    },
    data: {
      attempts: candidate.attempts + 1,
      nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS),
    },
  });
  if (count !== 1) return null;

  return prisma.ltiScoreQueue.findUnique({
    where: { id: candidate.id },
    include: {
      assignment: { select: { id: true, title: true, courseId: true } },
      user: { select: { id: true } },
    },
  });
}

/** Mark a queued grade as delivered. */
export async function markSent(id: string, now = new Date()): Promise<void> {
  await prisma.ltiScoreQueue.update({
    where: { id },
    data: { state: 'SENT', sentAt: now, lastError: null },
  });
}

/**
 * Record a failed attempt, scheduling a retry or giving up.
 *
 * `retryable` is the difference between a busy LMS and a wrong registration. A refused grade
 * will be refused again in five minutes, so it stops immediately and says why; an unreachable
 * one is worth waiting for.
 */
export async function markFailed(opts: {
  id: string;
  attempts: number;
  error: string;
  retryable: boolean;
  now?: Date;
}): Promise<{ state: LtiScoreState }> {
  const now = opts.now ?? new Date();
  const exhausted = opts.attempts >= MAX_ATTEMPTS;
  const giveUp = exhausted || !opts.retryable;

  const minutes = BACKOFF_MINUTES[Math.min(opts.attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 1;

  await prisma.ltiScoreQueue.update({
    where: { id: opts.id },
    data: {
      state: giveUp ? 'FAILED' : 'PENDING',
      lastError: opts.error.slice(0, 500),
      nextAttemptAt: new Date(now.getTime() + minutes * 60_000),
    },
  });

  return { state: giveUp ? 'FAILED' : 'PENDING' };
}

/** What faculty are shown for one assignment: how many are waiting, failed, and sent. */
export async function scoreQueueSummary(assignmentId: string) {
  const rows = await prisma.ltiScoreQueue.groupBy({
    by: ['state'],
    where: { assignmentId },
    _count: { _all: true },
  });

  const count = (state: LtiScoreState) => rows.find((row) => row.state === state)?._count._all ?? 0;

  const lastSent = await prisma.ltiScoreQueue.findFirst({
    where: { assignmentId, state: 'SENT' },
    orderBy: { sentAt: 'desc' },
    select: { sentAt: true },
  });

  return {
    pending: count('PENDING'),
    sent: count('SENT'),
    failed: count('FAILED'),
    lastSentAt: lastSent?.sentAt ?? null,
  };
}
