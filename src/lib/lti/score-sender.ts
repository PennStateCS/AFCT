/**
 * Draining the grade queue into the LMS.
 *
 * Runs in the app container, not the submission worker: the worker has no network egress by
 * design, and this needs to reach the LMS.
 */

import { prisma } from '@/lib/prisma';
import { claimNextScore, markSent, markFailed } from '@/lib/lti/score-queue';
import { ensureLineItem, postScore, findLtiUserId, agsFailureMessage } from '@/lib/lti/ags';
import type { AgsFailure } from '@/lib/lti/ags';

/** How often to look for work. */
const SEND_INTERVAL_MS = 60_000;

/** Failures worth waiting on, as opposed to ones a person has to fix. */
const RETRYABLE: AgsFailure[] = ['unreachable', 'no-token'];

let started = false;

export type SendOutcome =
  { status: 'idle' } | { status: 'sent' } | { status: 'failed'; reason: AgsFailure };

/**
 * Send at most one queued grade.
 *
 * Returns rather than throws, so the loop can carry on. A grade that cannot be sent is left in
 * the queue with the reason on it, never dropped.
 */
export async function sendOneScore(): Promise<SendOutcome> {
  const claimed = await claimNextScore();
  if (!claimed) return { status: 'idle' };

  const fail = async (reason: AgsFailure, detail?: string) => {
    await markFailed({
      id: claimed.id,
      attempts: claimed.attempts,
      error: detail ? `${agsFailureMessage(reason)} (${detail})` : agsFailureMessage(reason),
      retryable: RETRYABLE.includes(reason),
    });
    return { status: 'failed' as const, reason };
  };

  /**
   * Which LMS course to send to.
   *
   * Cross-listed sections mean several LMS courses can open one AFCT course, and AFCT does not
   * record which one a given student came through. Each is tried in turn: the platform refuses
   * a student who is not in that course, so the right one wins. Recording it per student at
   * launch would be better and belongs with roster sync.
   */
  const links = await prisma.ltiContextLink.findMany({
    where: { courseId: claimed.assignment.courseId },
    include: { platform: { select: { id: true, clientId: true, tokenUrl: true, issuer: true } } },
  });
  if (links.length === 0) return fail('no-line-items-endpoint');

  let lastReason: AgsFailure = 'rejected';
  let lastDetail: string | undefined;

  for (const link of links) {
    const ltiUserId = await findLtiUserId({
      userId: claimed.userId,
      issuer: link.platform.issuer,
    });
    if (!ltiUserId) {
      lastReason = 'no-lms-identity';
      continue;
    }

    const lineItem = await ensureLineItem({
      platform: link.platform,
      contextLinkId: link.id,
      lineItemsUrl: link.lineItemsUrl,
      assignmentId: claimed.assignmentId,
      label: claimed.assignment.title,
      scoreMaximum: claimed.scoreMaximum,
    });
    if (!lineItem.ok) {
      lastReason = lineItem.reason;
      lastDetail = lineItem.detail;
      continue;
    }

    const sent = await postScore({
      platform: link.platform,
      lineItemUrl: lineItem.value,
      ltiUserId,
      scoreGiven: claimed.scoreGiven,
      scoreMaximum: claimed.scoreMaximum,
    });
    if (sent.ok) {
      await markSent(claimed.id);
      return { status: 'sent' };
    }

    lastReason = sent.reason;
    lastDetail = sent.detail;
  }

  return fail(lastReason, lastDetail);
}

/** Drain what is due, with a ceiling so one pass cannot run away. */
async function drain(limit = 50): Promise<void> {
  for (let i = 0; i < limit; i++) {
    try {
      const outcome = await sendOneScore();
      if (outcome.status === 'idle') return;
    } catch (error) {
      // A grade left claimed retries on the next pass, so stopping here loses nothing.
      console.error('[lti-scores] send failed:', error);
      return;
    }
  }
}

async function loop(): Promise<void> {
  await drain();
  setTimeout(() => void loop(), SEND_INTERVAL_MS);
}

/** Start the sender. Safe to call more than once. */
export function startScoreSender(): void {
  if (started) return;
  started = true;
  void loop();
}
