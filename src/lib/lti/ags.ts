/**
 * Sending grades back to an LMS.
 *
 * Treat this as grade-integrity work rather than an integration nicety: a score that silently
 * fails to arrive is the same class of failure as losing one. Every call returns a result
 * saying what happened, so a caller can record it instead of guessing.
 */

import { prisma } from '@/lib/prisma';
import { getAccessToken } from '@/lib/lti/access-token';

/** Content types AGS defines for its two endpoints. */
const LINE_ITEM_TYPE = 'application/vnd.ims.lis.v2.lineitem+json';
const SCORE_TYPE = 'application/vnd.ims.lis.v1.score+json';

export type AgsFailure =
  /** No access token: the platform refused AFCT, or could not be reached. */
  | 'no-token'
  /** The platform did not grant grade scopes for this course. */
  | 'no-line-items-endpoint'
  /** The platform rejected the request. */
  | 'rejected'
  /** The platform could not be reached. */
  | 'unreachable'
  /** This person has never launched, so the LMS user id is unknown. */
  | 'no-lms-identity';

export type AgsResult<T> =
  { ok: true; value: T } | { ok: false; reason: AgsFailure; detail?: string };

type PlatformRef = { id: string; clientId: string; tokenUrl: string };

async function authorised(platform: PlatformRef) {
  const token = await getAccessToken({
    platformId: platform.id,
    clientId: platform.clientId,
    tokenUrl: platform.tokenUrl,
  });
  return token;
}

/** POST/GET against a platform endpoint, mapping the usual failures onto named reasons. */
async function call(
  url: string,
  token: string,
  contentType: string,
  body: unknown,
): Promise<AgsResult<Response>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      detail: error instanceof Error ? error.message : 'network error',
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'rejected', detail: detail.slice(0, 500) };
  }
  return { ok: true, value: response };
}

/**
 * The gradebook column for an assignment, creating it if this is the first grade.
 *
 * Remembered afterwards, so a later grade goes to the same column rather than making another.
 */
export async function ensureLineItem(opts: {
  platform: PlatformRef;
  contextLinkId: string;
  lineItemsUrl: string | null;
  assignmentId: string;
  label: string;
  scoreMaximum: number;
}): Promise<AgsResult<string>> {
  const existing = await prisma.ltiLineItem.findUnique({
    where: {
      contextLinkId_assignmentId: {
        contextLinkId: opts.contextLinkId,
        assignmentId: opts.assignmentId,
      },
    },
    select: { url: true },
  });
  if (existing) return { ok: true, value: existing.url };

  if (!opts.lineItemsUrl) return { ok: false, reason: 'no-line-items-endpoint' };

  const token = await authorised(opts.platform);
  if (!token.ok) return { ok: false, reason: 'no-token', detail: token.reason };

  const created = await call(opts.lineItemsUrl, token.token, LINE_ITEM_TYPE, {
    scoreMaximum: opts.scoreMaximum,
    label: opts.label,
    // Ties the column to the AFCT assignment, so a second attempt finds the platform's own
    // existing column rather than duplicating it.
    resourceId: opts.assignmentId,
  });
  if (!created.ok) return created;

  const body = (await created.value.json().catch(() => null)) as { id?: unknown } | null;
  const url = typeof body?.id === 'string' ? body.id : null;
  if (!url)
    return { ok: false, reason: 'rejected', detail: 'the platform returned no line item id' };

  await prisma.ltiLineItem.create({
    data: { contextLinkId: opts.contextLinkId, assignmentId: opts.assignmentId, url },
  });

  return { ok: true, value: url };
}

/**
 * Send one student's score.
 *
 * Needs the LMS's own id for that person, which AFCT only learns from a launch. Until roster
 * sync lands, a student who has never opened AFCT from the LMS cannot be sent, and that has to
 * be visible rather than quietly skipped.
 */
export async function postScore(opts: {
  platform: PlatformRef;
  lineItemUrl: string;
  ltiUserId: string;
  scoreGiven: number;
  scoreMaximum: number;
  timestamp?: Date;
  comment?: string | null;
}): Promise<AgsResult<null>> {
  const token = await authorised(opts.platform);
  if (!token.ok) return { ok: false, reason: 'no-token', detail: token.reason };

  // Scores go to the line item's own `/scores` sub-resource, keeping any query string the
  // platform put on the line item URL.
  const url = new URL(opts.lineItemUrl);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/scores`;

  const sent = await call(url.toString(), token.token, SCORE_TYPE, {
    userId: opts.ltiUserId,
    scoreGiven: opts.scoreGiven,
    scoreMaximum: opts.scoreMaximum,
    timestamp: (opts.timestamp ?? new Date()).toISOString(),
    // A grade exists, so the work is done and the score counts. AFCT has no notion of a
    // partially-submitted attempt to report here.
    activityProgress: 'Completed',
    gradingProgress: 'FullyGraded',
    ...(opts.comment ? { comment: opts.comment } : {}),
  });
  if (!sent.ok) return sent;

  return { ok: true, value: null };
}

/** The LMS's id for a person, from the identity a launch created. Null if they never launched. */
export async function findLtiUserId(opts: {
  userId: string;
  issuer: string;
}): Promise<string | null> {
  const identity = await prisma.linkedIdentity.findFirst({
    where: { userId: opts.userId, kind: 'LTI', issuer: opts.issuer },
    select: { subject: true },
  });
  return identity?.subject ?? null;
}

/** What to tell faculty when a grade could not be sent. Says what to do about it. */
export function agsFailureMessage(reason: AgsFailure): string {
  switch (reason) {
    case 'no-lms-identity':
      return 'This student has not opened AFCT from your LMS yet, so their grade cannot be sent there.';
    case 'no-line-items-endpoint':
      return 'Your LMS did not give AFCT permission to write grades for this course. An administrator needs to allow the grade services when registering AFCT.';
    case 'no-token':
      return 'AFCT could not authenticate with your LMS. Check the LTI registration in System Settings.';
    case 'unreachable':
      return 'AFCT could not reach your LMS. Grades will be sent again when it is available.';
    case 'rejected':
    default:
      return 'Your LMS refused the grade. Check that the assignment still exists there.';
  }
}
