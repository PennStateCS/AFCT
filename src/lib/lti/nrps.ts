/**
 * Reading a course roster from the LMS.
 *
 * The LMS is the authority on who is in a course, so this is what eventually lets AFCT grade
 * students who have never opened it, and what makes a drop visible. Nothing here changes AFCT's
 * own roster: it reads, and something else decides what to do about the difference.
 */

import { getAccessToken } from '@/lib/lti/access-token';

/** Reading membership needs its own scope, separate from the grade ones. */
export const NRPS_SCOPES = [
  'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly',
] as const;

const MEMBERSHIP_TYPE = 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json';

/** Stop following pages after this many, so a broken platform cannot loop for ever. */
const MAX_PAGES = 50;

export type Member = {
  /** The LMS's own id for this person, which is what a grade is posted against. */
  ltiUserId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** LTI role URIs, exactly as sent. */
  roles: string[];
  /** False when the LMS says they are no longer active in the course. */
  active: boolean;
};

export type NrpsFailure =
  | 'no-token'
  | 'no-endpoint'
  | 'rejected'
  | 'unreachable'
  /** More pages remained than we will follow, so the roster read is incomplete. */
  | 'incomplete';

export type NrpsResult =
  { ok: true; members: Member[] } | { ok: false; reason: NrpsFailure; detail?: string };

/** The next page, from the `Link` header. NRPS pages a roster rather than sending it whole. */
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

function readMember(raw: unknown): Member | null {
  const member = raw as Record<string, unknown>;
  const ltiUserId = typeof member?.user_id === 'string' ? member.user_id : null;
  if (!ltiUserId) return null;

  const roles = Array.isArray(member.roles)
    ? member.roles.filter((r): r is string => typeof r === 'string')
    : [];

  return {
    ltiUserId,
    email: typeof member.email === 'string' ? member.email.trim().toLowerCase() : null,
    firstName: typeof member.given_name === 'string' ? member.given_name : null,
    lastName: typeof member.family_name === 'string' ? member.family_name : null,
    roles,
    // The LMS reports a dropped student as Inactive or Deleted rather than omitting them,
    // which is what lets AFCT tell "dropped" from "never seen".
    active: member.status !== 'Inactive' && member.status !== 'Deleted',
  };
}

/** Everyone the LMS says is in this course, following pages. */
export async function fetchMembership(opts: {
  platform: { id: string; clientId: string; tokenUrl: string };
  membershipsUrl: string | null;
}): Promise<NrpsResult> {
  if (!opts.membershipsUrl) return { ok: false, reason: 'no-endpoint' };

  const token = await getAccessToken({
    platformId: opts.platform.id,
    clientId: opts.platform.clientId,
    tokenUrl: opts.platform.tokenUrl,
    scopes: NRPS_SCOPES,
  });
  if (!token.ok) return { ok: false, reason: 'no-token', detail: token.reason };

  const members: Member[] = [];
  let url: string | null = opts.membershipsUrl;
  // A platform that points a page back at one already read would otherwise loop until the page
  // cap and return a roster full of duplicates.
  const seen = new Set<string>();

  for (let page = 0; url && page < MAX_PAGES; page++) {
    if (seen.has(url)) return { ok: false, reason: 'incomplete', detail: 'the roster pages repeat' };
    seen.add(url);

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token.token}`, Accept: MEMBERSHIP_TYPE },
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

    const body = (await response.json().catch(() => null)) as { members?: unknown } | null;
    const pageMembers = Array.isArray(body?.members) ? body.members : [];
    for (const raw of pageMembers) {
      const member = readMember(raw);
      if (member) members.push(member);
    }

    url = nextPage(response);
  }

  /**
   * Fail closed. A `rel="next"` still outstanding means the LMS has more people to give, and
   * returning what we have would look identical to a complete roster. The caller diffs this
   * against AFCT's own roster, so a truncated read proposes dropping everyone past the cut.
   */
  if (url) {
    return { ok: false, reason: 'incomplete', detail: `more than ${MAX_PAGES} pages of members` };
  }

  return { ok: true, members };
}

/** What to tell faculty when the roster cannot be read. */
export function nrpsFailureMessage(reason: NrpsFailure): string {
  switch (reason) {
    case 'no-endpoint':
      return 'Your LMS did not give AFCT permission to read this course’s roster. An administrator needs to allow the names and roles service when registering AFCT.';
    case 'no-token':
      return 'AFCT could not authenticate with your LMS. Check the LTI registration in System Settings.';
    case 'unreachable':
      return 'AFCT could not reach your LMS. Try again shortly.';
    case 'incomplete':
      return 'AFCT could not read your whole course roster from your LMS, so it has not changed anything. Try again shortly, and tell an administrator if it keeps happening.';
    case 'rejected':
    default:
      return 'Your LMS refused to share this course’s roster. Check that AFCT is still installed in that course.';
  }
}
