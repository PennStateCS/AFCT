/**
 * Sending grades back to an LMS.
 *
 * Treat this as grade-integrity work rather than an integration nicety: a score that silently
 * fails to arrive is the same class of failure as losing one. Every call returns a result
 * saying what happened, so a caller can record it instead of guessing.
 */

import { prisma } from '@/lib/prisma';
import {
  samePageOrigin,
  authorisedFetch,
  authorisedFetchFailureDetail,
  preferPlatformScheme,
} from '@/lib/lti/authorised-fetch';
import { AGS_LINE_ITEM_SCOPES, AGS_SCORE_SCOPES, getAccessToken } from '@/lib/lti/access-token';

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
  /**
   * The platform redirected the call somewhere else, which drops the credentials.
   *
   * Kept apart from `unreachable` because it is the opposite kind of problem: nothing is down
   * and retrying will never help, since the platform will redirect the next attempt too. It is
   * a setting on the LMS, and saying so is the whole point of noticing it.
   */
  | 'redirected'
  /** This person has never launched, so the LMS user id is unknown. */
  | 'no-lms-identity'
  /**
   * The AFCT course is open from several LMS courses and AFCT cannot tell which one this
   * student belongs to, so it will not guess which gradebook to write to.
   */
  | 'ambiguous-context'
  /**
   * AFCT could not read the whole list of columns, so it does not know whether one already
   * exists. Distinct from a plain failure because it is the case where creating a column would
   * duplicate one that is already there, which is the outcome worth avoiding most.
   */
  | 'line-item-lookup-incomplete'
  /** The lookup itself failed. Same consequence as above: do not create, try again later. */
  | 'line-item-lookup-failed'
  /**
   * The column's maximum had to change and the platform would not take the change. Sending the
   * score anyway would report it against the old maximum, which is a wrong grade.
   */
  | 'line-item-update-failed';

export type AgsResult<T> =
  { ok: true; value: T } | { ok: false; reason: AgsFailure; detail?: string };

type PlatformRef = { id: string; clientId: string; tokenUrl: string };

/**
 * A token for one operation, asking only for what that operation needs.
 *
 * AGS defines the scopes separately: `score` posts a grade, `lineitem` manages columns. Asking
 * for both every time means a platform that granted only `score`, because it made the column
 * itself, refuses the whole request and no grade is sent at all. The token cache is keyed by
 * scope, so the two are cached apart rather than one evicting the other.
 */
async function authorised(platform: PlatformRef, scopes: readonly string[]) {
  const token = await getAccessToken({
    platformId: platform.id,
    clientId: platform.clientId,
    tokenUrl: platform.tokenUrl,
    scopes,
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
    const attempt = await authorisedFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: JSON.stringify(body),
    });
    if (!attempt.ok) {
      return {
        ok: false,
        reason:
          attempt.failure.kind === 'redirected' || attempt.failure.kind === 'insecure'
            ? 'redirected'
            : 'unreachable',
        detail: authorisedFetchFailureDetail(attempt.failure),
      };
    }
    response = attempt.response;
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

/**
 * What a lookup actually established.
 *
 * The point of the four cases is that only one of them may lead to creating a column. Returning
 * null for both "there is no column" and "I could not find out" is how a gradebook ends up with
 * two columns for one assignment: every failure read as an invitation to make another.
 */
export type LineItemLookup =
  | { status: 'found'; url: string }
  /** Every page was read and none of them had it. The only case that may create. */
  | { status: 'not-found' }
  /** Pages ran out, or repeated, before the list was exhausted. It may or may not be there. */
  | { status: 'incomplete'; detail: string }
  /**
   * The platform refused, was unreachable, or answered with something unreadable.
   *
   * `httpStatus` is carried because it decides whether waiting helps. A 404 or a 403 on the
   * column list will say the same thing tomorrow and needs somebody to look at the
   * registration; a 503 or a dropped connection is worth retrying. Both must still fail closed.
   */
  | { status: 'error'; detail: string; httpStatus?: number };

async function findLineItem(
  lineItemsUrl: string,
  token: string,
  resourceId: string,
): Promise<LineItemLookup> {
  let first: URL;
  try {
    first = new URL(lineItemsUrl);
  } catch {
    return { status: 'error', detail: 'the line items address is not a URL' };
  }
  // AGS defines `resource_id` as the filter for finding your own column.
  first.searchParams.set('resource_id', resourceId);

  const origin = first.origin;
  // AGS lets a platform page the line items even when filtering, so the column may not be on the
  // first page. Concluding "not there" from page one creates a second column.
  let next: string | null = first.toString();
  const seen = new Set<string>();

  for (let page = 0; page < MAX_LINE_ITEM_PAGES; page++) {
    if (seen.has(next)) {
      return { status: 'incomplete', detail: 'the line item pages repeat' };
    }
    seen.add(next);

    const attempt = await authorisedFetch(next, {
      headers: { Authorization: `Bearer ${token}`, Accept: LINE_ITEM_CONTAINER_TYPE },
    });
    if (!attempt.ok) {
      return { status: 'error', detail: authorisedFetchFailureDetail(attempt.failure) };
    }
    const response = attempt.response;

    if (!response.ok) {
      return {
        status: 'error',
        detail: `the platform answered ${response.status}`,
        httpStatus: response.status,
      };
    }

    const body = (await response.json().catch(() => undefined)) as unknown;
    // AGS: a line item container is a JSON array, and an empty result "MUST just be an empty
    // array". Anything else means the answer was not understood, which is not the same as the
    // column being absent.
    if (!Array.isArray(body)) {
      return { status: 'error', detail: 'the platform did not answer with a line item list' };
    }

    /**
     * Check what came back, rather than trusting the filter.
     *
     * The request asks for `resource_id=<assignment>`, and AGS says a platform should honour it.
     * A platform that ignores it answers with *every* column in the course, and taking the first
     * one would send every grade for this assignment to somebody else's column. That is worse
     * than creating a duplicate, because it is wrong rather than merely untidy, and it is silent.
     *
     * A column with no `resourceId` is not a match either. Those exist: a deep link that did not
     * send one leaves the platform storing a column it cannot recognise later, and adopting it
     * here on a guess is the same wrong-column failure from the other direction.
     */
    for (const item of body) {
      const row = item as { id?: unknown; resourceId?: unknown };
      const id = row?.id;
      if (typeof id !== 'string' || id.length === 0) continue;
      if (row?.resourceId !== resourceId) continue;
      return { status: 'found', url: id };
    }

    const advertised = nextPage(response);
    if (!advertised) return { status: 'not-found' };

    const following = samePageOrigin(advertised, origin);
    if (!following) {
      return { status: 'error', detail: 'the next page of line items is not on the same server' };
    }
    next = following;
  }

  // The loop ended on the page cap with another page still advertised, so the list was never
  // exhausted and "not there" was never established.
  return { status: 'incomplete', detail: `more than ${MAX_LINE_ITEM_PAGES} pages of line items` };
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
     * The two are not the same kind of change and must not be treated alike. A platform scales
     * a score against the column's own maximum, so posting 120 to a column still set to 100
     * when the assignment is now out of 150 reports a wrong grade to the LMS. A stale *name* is
     * cosmetic, and refusing to grade over one would be worse than the blemish.
     */
    const maximumChanged = existing.scoreMaximum !== opts.scoreMaximum;
    const labelChanged = existing.label !== opts.label;
    if (!maximumChanged && !labelChanged) return { ok: true, value: existing.url };

    const updated = await updateLineItem(existing.url, opts);
    if (!updated.ok) {
      // Cosmetic: grade against the column as it stands, and try the rename again next time.
      // The stored copy is deliberately left alone, which is what makes that retry happen.
      if (!maximumChanged) return { ok: true, value: existing.url };
      // Not cosmetic. Nothing may be posted against a column whose maximum is still the old one.
      return updated;
    }
    return { ok: true, value: existing.url };
  }

  if (!opts.lineItemsUrl) return { ok: false, reason: 'no-line-items-endpoint' };
  // The platform's own token endpoint is the evidence that it speaks TLS on this host, so an
  // http service address beside it is a misconfiguration to repair rather than a decision to
  // respect. Anything else is left exactly as the platform signed it.
  const lineItemsUrl = preferPlatformScheme(opts.lineItemsUrl, opts.platform.tokenUrl);

  const token = await authorised(opts.platform, AGS_LINE_ITEM_SCOPES);
  if (!token.ok) return { ok: false, reason: 'no-token', detail: token.reason };

  const already = await findLineItem(lineItemsUrl, token.token, opts.assignmentId);
  if (already.status === 'found') {
    return remember(opts.contextLinkId, opts.assignmentId, already.url, {
      label: opts.label,
      scoreMaximum: opts.scoreMaximum,
    });
  }
  // Anything short of a completed search leaves the grade queued. Creating here is what would
  // put a second column in somebody's gradebook, and that is harder to undo than a late grade.
  if (already.status !== 'not-found') return lookupFailure(already);

  const created = await call(lineItemsUrl, token.token, LINE_ITEM_TYPE, {
    scoreMaximum: opts.scoreMaximum,
    label: opts.label,
    // Ties the column to the AFCT assignment, so a second attempt finds the platform's own
    // existing column rather than duplicating it.
    resourceId: opts.assignmentId,
  });
  if (!created.ok) return created;

  const body = (await created.value.json().catch(() => null)) as { id?: unknown } | null;
  // AGS says the response "MUST be the newly created item, enriched by its URL". Not every
  // platform obliges: the 1EdTech reference implementation answers with an HTML page. Asking for
  // the column we just made is the reliable way to learn its URL.
  let url = typeof body?.id === 'string' && body.id.length > 0 ? body.id : null;

  if (!url) {
    // The same explicit handling as above. The column now exists, so a lookup that cannot say
    // where it is must not be reported as though the platform refused the whole thing: the
    // grade needs to retry and find it, not create another.
    const rediscovered = await findLineItem(lineItemsUrl, token.token, opts.assignmentId);
    if (rediscovered.status === 'found') {
      url = rediscovered.url;
    } else if (rediscovered.status === 'not-found') {
      return {
        ok: false,
        reason: 'rejected',
        detail: 'the platform accepted the new column and then did not list it',
      };
    } else {
      return lookupFailure(rediscovered);
    }
  }

  return remember(opts.contextLinkId, opts.assignmentId, url, {
    label: opts.label,
    scoreMaximum: opts.scoreMaximum,
  });
}

/** Turn a lookup that did not conclude into the matching AGS failure. */
function lookupFailure(lookup: LineItemLookup): AgsResult<never> {
  if (lookup.status === 'incomplete') {
    return { ok: false, reason: 'line-item-lookup-incomplete', detail: lookup.detail };
  }
  if (lookup.status === 'error') {
    // A refusal is a refusal: retrying a 404 or a 403 for a day wastes the time of whoever has
    // to correct the registration. Anything else is worth waiting on.
    const refused =
      lookup.httpStatus !== undefined && lookup.httpStatus >= 400 && lookup.httpStatus < 500;
    return {
      ok: false,
      reason: refused ? 'rejected' : 'line-item-lookup-failed',
      detail: lookup.detail,
    };
  }
  // Neither of the concluding cases reaches here; the signature is what makes that provable.
  return { ok: false, reason: 'line-item-lookup-failed' };
}

/**
 * Tell the platform the column's new name or maximum.
 *
 * AGS is explicit that a PUT "replaces the line item definition with the new, complete
 * definition provided by the tool", so the only safe way to change two fields is to read the
 * whole thing and send it back with those two altered. There used to be a fallback that sent a
 * minimal body when the read failed; that is a destructive write. It silently discarded whatever
 * the platform keeps on a column (due dates, tags, release settings, grading rules) on exactly
 * the occasions AFCT knew least about what it was overwriting.
 *
 * So a failed read is now a failed update, and the caller decides what that costs. Nothing is
 * written to AFCT's own copy unless the platform confirmed the change, which is what makes the
 * next attempt try again instead of believing it already succeeded.
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
): Promise<AgsResult<null>> {
  const token = await authorised(opts.platform, AGS_LINE_ITEM_SCOPES);
  if (!token.ok) return { ok: false, reason: 'no-token', detail: token.reason };

  const current = await readLineItem(url, token.token);
  if (!current.ok) return current;

  let response: Response;
  try {
    const attempt = await authorisedFetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token.token}`, 'Content-Type': LINE_ITEM_TYPE },
      body: JSON.stringify({
        // Everything the platform had, with only the two properties AFCT owns changed.
        // `resourceId` is ours by the spec's own account: the platform "MUST NOT" modify it.
        ...current.value,
        scoreMaximum: opts.scoreMaximum,
        label: opts.label,
        resourceId: opts.assignmentId,
      }),
    });
    if (!attempt.ok) {
      return {
        ok: false,
        reason:
          attempt.failure.kind === 'redirected' || attempt.failure.kind === 'insecure'
            ? 'redirected'
            : 'unreachable',
        detail: authorisedFetchFailureDetail(attempt.failure),
      };
    }
    response = attempt.response;
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      detail: error instanceof Error ? error.message : 'network error',
    };
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: 'line-item-update-failed', detail: detail.slice(0, 500) };
  }

  /**
   * Confirm rather than assume.
   *
   * A 200 says the platform accepted the request, not that the column now reads 150. Platforms
   * do clamp or ignore properties. Since a wrong maximum is a wrong grade, the new value has to
   * be read back from what the platform says the column is now.
   */
  const confirmed = await confirmMaximum(response, url, token.token, opts.scoreMaximum);
  if (!confirmed.ok) return confirmed;

  await prisma.ltiLineItem.update({
    where: {
      contextLinkId_assignmentId: {
        contextLinkId: opts.contextLinkId,
        assignmentId: opts.assignmentId,
      },
    },
    data: { label: opts.label, scoreMaximum: opts.scoreMaximum },
  });
  return { ok: true, value: null };
}

/** The column as the platform currently has it, so a PUT can put back what it does not own. */
async function readLineItem(
  url: string,
  token: string,
): Promise<AgsResult<Record<string, unknown>>> {
  let response: Response;
  try {
    const attempt = await authorisedFetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: LINE_ITEM_TYPE },
    });
    if (!attempt.ok) {
      return {
        ok: false,
        reason:
          attempt.failure.kind === 'redirected' || attempt.failure.kind === 'insecure'
            ? 'redirected'
            : 'unreachable',
        detail: authorisedFetchFailureDetail(attempt.failure),
      };
    }
    response = attempt.response;
  } catch (error) {
    return {
      ok: false,
      reason: 'unreachable',
      detail: error instanceof Error ? error.message : 'network error',
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: 'line-item-update-failed',
      detail: `could not read the column before changing it (${response.status})`,
    };
  }

  const body = (await response.json().catch(() => null)) as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      reason: 'line-item-update-failed',
      detail: 'the platform did not answer with a line item',
    };
  }
  return { ok: true, value: body as Record<string, unknown> };
}

/**
 * Check the platform really applied the new maximum.
 *
 * AGS says the PUT response is the updated line item, so the usual case needs no extra call.
 * A platform that answers with something else gets one GET to settle it.
 */
async function confirmMaximum(
  putResponse: Response,
  url: string,
  token: string,
  expected: number,
): Promise<AgsResult<null>> {
  const stated = (await putResponse.json().catch(() => null)) as { scoreMaximum?: unknown } | null;
  if (typeof stated?.scoreMaximum === 'number') {
    return stated.scoreMaximum === expected
      ? { ok: true, value: null }
      : {
          ok: false,
          reason: 'line-item-update-failed',
          detail: `the column is still out of ${stated.scoreMaximum}`,
        };
  }

  const reread = await readLineItem(url, token);
  if (!reread.ok) return reread;
  if (reread.value.scoreMaximum === expected) return { ok: true, value: null };
  return {
    ok: false,
    reason: 'line-item-update-failed',
    detail: `the column is still out of ${String(reread.value.scoreMaximum)}`,
  };
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
 * Needs the LMS's own id for that person, which AFCT learns either from a launch or from a
 * roster sync: both attach the LTI identity that `findLtiUserId` reads. A student who has done
 * neither cannot be sent, and that has to be visible rather than quietly skipped.
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
  const token = await authorised(opts.platform, AGS_SCORE_SCOPES);
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
      // Reached only after asking the LMS for its roster, so "they have not launched" is no
      // longer the explanation and would send somebody looking in the wrong place.
      return 'Your LMS does not list this student in this course, so AFCT has nowhere to put their grade. Check they are enrolled there, or that their email matches the one AFCT holds.';
    case 'no-line-items-endpoint':
      return 'Your LMS did not give AFCT permission to write grades for this course. An administrator needs to allow the grade services when registering AFCT.';
    case 'no-token':
      return 'AFCT could not authenticate with your LMS. Check the LTI registration in System Settings.';
    case 'unreachable':
      return 'AFCT could not reach your LMS. Grades will be sent again when it is available.';
    case 'redirected':
      // Deliberately names the cause rather than the symptom. Left as a bare 401 this looked
      // like a permissions problem and sent an administrator through LMS permission screens
      // that were already correct.
      return 'Your LMS gave AFCT a plain http address for its grade service and then redirected it to https, which drops the credentials AFCT sends and makes the request look unauthorised. Set your LMS to advertise https for its own address.';
    case 'ambiguous-context':
      return 'This AFCT course is connected to more than one LMS course, and AFCT cannot tell which one this student is in, so it has not sent the grade anywhere. Sync the roster from the LMS course this student belongs to.';
    case 'line-item-lookup-incomplete':
    case 'line-item-lookup-failed':
      return 'AFCT could not check whether your LMS already has a column for this assignment, so it has not made one. The grade stays queued and will be sent when the LMS answers.';
    case 'line-item-update-failed':
      return 'This assignment is now worth a different number of points and your LMS would not accept the change, so the grade has not been sent. Sending it against the old total would report the wrong mark. Check the column in your LMS gradebook.';
    case 'rejected':
    default:
      return 'Your LMS refused the grade. Check that the assignment still exists there.';
  }
}
