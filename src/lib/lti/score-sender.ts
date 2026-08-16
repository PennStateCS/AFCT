/**
 * Draining the grade queue into the LMS.
 *
 * Runs in the app container, not the submission worker: the worker has no network egress by
 * design, and this needs to reach the LMS.
 */

import { prisma } from '@/lib/prisma';
import { claimNextScore, markSent, markFailed } from '@/lib/lti/score-queue';
import { ensureLineItem, postScore, findLtiUserId, agsFailureMessage } from '@/lib/lti/ags';
import { resolveIdentityFromRoster } from '@/lib/lti/identity-from-roster';
import type { AgsFailure } from '@/lib/lti/ags';

/** How often to look for work. */
const SEND_INTERVAL_MS = 60_000;

/**
 * Failures worth waiting on, as opposed to ones a person has to fix.
 *
 * The line item lookup ones are here because they are transient by nature: the platform was
 * unreachable, slow, or paging oddly, and none of that is something faculty can act on. They
 * matter more than most, since the alternative to retrying was creating a duplicate column.
 *
 * A failed *update* is deliberately not retryable. It means the platform would not accept the
 * new maximum, and repeating a request it already refused will not change that: somebody has to
 * look at the column.
 */
const RETRYABLE: AgsFailure[] = [
  'unreachable',
  'no-token',
  'line-item-lookup-incomplete',
  'line-item-lookup-failed',
];

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
   * Cross-listed sections mean several LMS courses can open one AFCT course. This used to try
   * each in turn and let the platform refuse the wrong ones, but the first thing tried is
   * creating a gradebook column, so a section B student put an AFCT column in section A; and a
   * student in both sections got their grade wherever the query happened to order first.
   *
   * Which section a student is in is now recorded as `LtiContextMember`, written both when they
   * launch and when a roster is synced, and that is what the lookup below reads. It can still
   * come up empty, for a student who has neither launched nor been synced, and grades are the
   * thing this system must not get wrong: with more than one link and nothing saying which, it
   * refuses and says so rather than guessing.
   */
  const allLinks = await prisma.ltiContextLink.findMany({
    where: { courseId: claimed.assignment.courseId },
    include: { platform: { select: { id: true, clientId: true, tokenUrl: true, issuer: true } } },
  });
  if (allLinks.length === 0) return fail('no-line-items-endpoint');

  /**
   * With one LMS course there is nothing to choose. With several, the student's own membership
   * decides, recorded when they launched or when the roster was synced. If nothing says which
   * course they are in, this refuses: creating a column in the wrong section, or posting a
   * grade to whichever link came back first, is worse than saying so.
   */
  let links = allLinks;
  if (allLinks.length > 1) {
    const memberships = await prisma.ltiContextMember.findMany({
      where: { userId: claimed.userId, contextLinkId: { in: allLinks.map((l) => l.id) } },
      select: { contextLinkId: true },
    });
    const belongs = new Set(memberships.map((m) => m.contextLinkId));
    links = allLinks.filter((l) => belongs.has(l.id));
    if (links.length !== 1) return fail('ambiguous-context');
  }

  let lastReason: AgsFailure = 'rejected';
  let lastDetail: string | undefined;

  for (const link of links) {
    let ltiUserId = await findLtiUserId({
      userId: claimed.userId,
      issuer: link.platform.issuer,
    });

    /**
     * Nobody has told AFCT who this student is in the LMS, so ask the LMS.
     *
     * A student who works in AFCT without ever clicking the link in their LMS is ordinary, and
     * their grade still has to arrive. The platform's roster carries the id a grade is
     * addressed to, and AFCT is already registered for that scope. Only reached when the
     * cheap lookup found nothing, so the usual case still costs one query.
     */
    if (!ltiUserId) {
      const resolved = await resolveIdentityFromRoster({ userId: claimed.userId, link });
      if (resolved.ok) {
        ltiUserId = resolved.ltiUserId;
      } else {
        // An unreachable LMS is worth waiting for; a student who is genuinely not in the
        // course is not, and saying so immediately is what lets somebody act on it.
        lastReason = resolved.retryable ? 'unreachable' : 'no-lms-identity';
        // A refusal is its own thing: the student was found, and AFCT declined to attach the
        // identity. Carrying the reason through means the queue says which, rather than
        // sending somebody to check an enrolment that is perfectly correct.
        if (!resolved.retryable && resolved.reason === 'link-refused') {
          lastDetail = `the LMS account could not be attached: ${resolved.detail}`;
        }
        continue;
      }
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
  // Pick up grades changed since the last pass, for assignments set to sync automatically.
  try {
    const { queueAutomaticAssignments } = await import('@/lib/lti/grade-sync');
    await queueAutomaticAssignments();
  } catch (error) {
    console.error('[lti-scores] could not queue automatic grades:', error);
  }

  await drain();
  setTimeout(() => void loop(), SEND_INTERVAL_MS);
}

/** Start the sender. Safe to call more than once. */
export function startScoreSender(): void {
  if (started) return;
  started = true;
  void loop();
}
