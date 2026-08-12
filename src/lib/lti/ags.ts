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
const LINE_ITEM_CONTAINER_TYPE = 'application/vnd.ims.lis.v2.lineitemcontainer+json';
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
  | 'no-lms-identity'
  /**
   * The AFCT course is open from several LMS courses and AFCT cannot tell which one this
   * student belongs to, so it will not guess which gradebook to write to.
   */
  | 'ambiguous-context';

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
 * Ask the platform whether it already has a column for this assignment.
 *
 * Filtering by `resource_id` is how AGS says to find your own column. Doing this before
 * creating one is what stops a second column appearing when AFCT has forgotten the first: a
 * duplicate in somebody's gradebook is confusing and awkward to clean up.
 */
/** Stop following pages after this many, so a broken platform cannot loop for ever. */
const MAX_LINE_ITEM_PAGES = 20;

/** The next page, from the `Link` header. AGS pages line items the same way NRPS pages members. */
function nextPage(response: Response): string | null {
  const link = response.headers.get('link');
  if (!link) return null;
  for (const part of link.split(',')) {
    const [urlPart, ...params] = part.split(';');
    if (params.some((p) => p.trim() === 'rel="next"')) {
      return urlPart?.trim().replace(/^<|>$/g, '') ?? null;
    }
  }
  return null;
}

async function findLineItem(
  lineItemsUrl: string,
  token: string,
  resourceId: string,
): Promise<string | null> {
  try {
    const first = new URL(lineItemsUrl);
    first.searchParams.set('resource_id', resourceId);

    // AGS lets a platform page the line items even when filtering, so the column may not be on
    // the first page. Concluding "not there" from page one creates a second column.
    let next: string | null = first.toString();
    const seen = new Set<string>();

    for (let page = 0; next && page < MAX_LINE_ITEM_PAGES; page++) {
      if (seen.has(next)) break;
      seen.add(next);

      const response: Response = await fetch(next, {
        headers: { Authorization: `Bearer ${token}`, Accept: LINE_ITEM_CONTAINER_TYPE },
      });
      if (!response.ok) return null;

      const body = (await response.json().catch(() => null)) as unknown;
      const items = Array.isArray(body) ? body : [];
      for (const item of items) {
        const id = (item as { id?: unknown })?.id;
        if (typeof id === 'string') return id;
      }

      next = nextPage(response);
    }
    return null;
  } catch {
    // Only ever an optimisation: creating still works if this fails.
    return null;
  }
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
    select: { url: true, label: true, scoreMaximum: true },
  });

  if (existing) {
    /**
     * Correct the column if the assignment has been renamed or re-pointed since.
     *
     * The maximum matters more than the name: a platform scales a score against the column's
     * own maximum, so an assignment that grew from 100 to 150 points would have every grade
     * silently misreported until this catches up.
     */
    const stale = existing.label !== opts.label || existing.scoreMaximum !== opts.scoreMaximum;
    if (stale) await updateLineItem(existing.url, opts);
    return { ok: true, value: existing.url };
  }

  if (!opts.lineItemsUrl) return { ok: false, reason: 'no-line-items-endpoint' };

  const token = await authorised(opts.platform);
  if (!token.ok) return { ok: false, reason: 'no-token', detail: token.reason };

  const already = await findLineItem(opts.lineItemsUrl, token.token, opts.assignmentId);
  if (already) {
    return remember(opts.contextLinkId, opts.assignmentId, already, {
      label: opts.label,
      scoreMaximum: opts.scoreMaximum,
    });
  }

  const created = await call(opts.lineItemsUrl, token.token, LINE_ITEM_TYPE, {
    scoreMaximum: opts.scoreMaximum,
    label: opts.label,
    // Ties the column to the AFCT assignment, so a second attempt finds the platform's own
    // existing column rather than duplicating it.
    resourceId: opts.assignmentId,
  });
  if (!created.ok) return created;

  const body = (await created.value.json().catch(() => null)) as { id?: unknown } | null;
  // The spec says the created line item comes back as JSON. Not every platform obliges: the
  // 1EdTech reference implementation answers with an HTML page. Asking for the column we just
  // made is the reliable way to learn its URL.
  const url =
    typeof body?.id === 'string'
      ? body.id
      : await findLineItem(opts.lineItemsUrl, token.token, opts.assignmentId);

  if (!url) {
    return { ok: false, reason: 'rejected', detail: 'the platform returned no line item id' };
  }

  return remember(opts.contextLinkId, opts.assignmentId, url, {
    label: opts.label,
    scoreMaximum: opts.scoreMaximum,
  });
}

/**
 * Tell the platform the column's new name or maximum.
 *
 * Best effort: a failure here leaves the stored shape unchanged, so the next grade tries again
 * rather than assuming it worked. Sending the score anyway is better than refusing to grade
 * because a title is out of date.
 */
async function updateLineItem(
  url: string,
  opts: {
    platform: PlatformRef;
    contextLinkId: string;
    assignmentId: string;
    label: string;
    scoreMaximum: number;
  },
): Promise<void> {
  const token = await authorised(opts.platform);
  if (!token.ok) return;

  /**
   * PUT replaces the line item, so anything the platform keeps on it (dates, tags, release
   * settings) would be dropped by sending only our three fields. Read it first and change the
   * two that are ours. A read that fails falls back to the minimal body: a stale maximum
   * misreports every grade on the column, so it is worth the trade.
   */
  let existing: Record<string, unknown> = {};
  try {
    const current = await fetch(url, {
      headers: { Authorization: `Bearer ${token.token}`, Accept: LINE_ITEM_TYPE },
    });
    if (current.ok) {
      const body = (await current.json().catch(() => null)) as unknown;
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        existing = body as Record<string, unknown>;
      }
    }
  } catch {
    // Ignored: fall through to the minimal body below.
  }

  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': LINE_ITEM_TYPE },
      body: JSON.stringify({
        ...existing,
        scoreMaximum: opts.scoreMaximum,
        label: opts.label,
        resourceId: opts.assignmentId,
      }),
    });
    if (!response.ok) return;
  } catch {
    return;
  }

  await prisma.ltiLineItem.update({
    where: {
      contextLinkId_assignmentId: {
        contextLinkId: opts.contextLinkId,
        assignmentId: opts.assignmentId,
      },
    },
    data: { label: opts.label, scoreMaximum: opts.scoreMaximum },
  });
}

/** Record the column so the next grade skips all of the above. */
async function remember(
  contextLinkId: string,
  assignmentId: string,
  url: string,
  shape: { label: string; scoreMaximum: number },
): Promise<AgsResult<string>> {
  await prisma.ltiLineItem.upsert({
    where: { contextLinkId_assignmentId: { contextLinkId, assignmentId } },
    create: { contextLinkId, assignmentId, url, ...shape },
    update: { url, ...shape },
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
    case 'ambiguous-context':
      return 'This AFCT course is connected to more than one LMS course, and AFCT cannot tell which one this student is in, so it has not sent the grade anywhere. Sync the roster from the LMS course this student belongs to.';
    case 'rejected':
    default:
      return 'Your LMS refused the grade. Check that the assignment still exists there.';
  }
}
