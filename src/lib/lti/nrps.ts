/**
 * Reading a course roster from the LMS.
 *
 * The LMS is the authority on who is in a course, so this is what eventually lets AFCT grade
 * students who have never opened it, and what makes a drop visible. Nothing here changes AFCT's
 * own roster: it reads, and something else decides what to do about the difference.
 */

import { getAccessToken } from '@/lib/lti/access-token';
import {
  authorisedFetch,
  authorisedFetchFailureDetail,
  samePageOrigin,
} from '@/lib/lti/authorised-fetch';

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
  | 'incomplete'
  /** The LMS answered with something that is not a membership container. */
  | 'malformed';

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

/**
 * One member, or null when the LMS did not send one AFCT can act on.
 *
 * Null is a refusal, not a skip: the caller fails the whole read. A roster is diffed against
 * AFCT's own, so a member quietly dropped here reads as a student who has left the course.
 *
 * Roles are taken exactly as sent or not at all. They decide whether somebody is enrolled as
 * faculty or as a student, so a array with a stray non-string in it is a message AFCT does not
 * understand rather than one to tidy up, and the launch validator treats its own role claim the
 * same way.
 */
function readMember(raw: unknown): Member | null {
  const member = raw as Record<string, unknown>;
  const ltiUserId = typeof member?.user_id === 'string' ? member.user_id : null;
  if (!ltiUserId) return null;

  // Required by NRPS, and load-bearing for authorisation, so its absence is malformed rather
  // than "no roles".
  if (!Array.isArray(member.roles)) return null;
  if (!member.roles.every((r): r is string => typeof r === 'string')) return null;
  const roles = member.roles;

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

  let firstUrl: URL;
  try {
    firstUrl = new URL(opts.membershipsUrl);
  } catch {
    return { ok: false, reason: 'malformed', detail: 'the roster address is not a URL' };
  }
  const firstOrigin = firstUrl.origin;

  const members: Member[] = [];
  let url: string | null = opts.membershipsUrl;
  // A platform that points a page back at one already read would otherwise loop until the page
  // cap and return a roster full of duplicates.
  const seen = new Set<string>();

  for (let page = 0; url && page < MAX_PAGES; page++) {
    if (seen.has(url))
      return { ok: false, reason: 'incomplete', detail: 'the roster pages repeat' };
    seen.add(url);

    // Through the shared helper, which refuses to follow a redirect: `fetch` drops the
    // Authorization header when a redirect crosses an origin, and following one at all would
    // hand this bearer token to wherever the platform pointed.
    const attempt = await authorisedFetch(url, {
      headers: { Authorization: `Bearer ${token.token}`, Accept: MEMBERSHIP_TYPE },
    });
    if (!attempt.ok) {
      return {
        ok: false,
        reason: attempt.failure.kind === 'redirected' ? 'rejected' : 'unreachable',
        detail: authorisedFetchFailureDetail(attempt.failure),
      };
    }
    const response = attempt.response;

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, reason: 'rejected', detail: detail.slice(0, 500) };
    }

    /**
     * A page that is not a membership container fails the read.
     *
     * Treating it as an empty page is the dangerous reading: an empty roster is a complete
     * answer as far as the caller can tell, and it proposes dropping every student in the
     * course. `{}`, `{"members": "nope"}` and `null` are all this case.
     */
    const body = (await response.json().catch(() => null)) as { members?: unknown } | null;
    if (!body || typeof body !== 'object' || !Array.isArray(body.members)) {
      return { ok: false, reason: 'malformed', detail: 'the membership list was missing' };
    }

    for (const raw of body.members) {
      const member = readMember(raw);
      if (!member) {
        return { ok: false, reason: 'malformed', detail: 'a member was missing an id or roles' };
      }
      members.push(member);
    }

    const advertised = nextPage(response);
    // No further page: clear the cursor before leaving, or the "pages remained" check below
    // reads this page's own address as one still outstanding.
    if (!advertised) {
      url = null;
      break;
    }

    /**
     * Only ever the origin the roster read started on.
     *
     * The `Link` header is the platform's to write and this request carries a bearer token, so
     * a next page pointing at another host would send that token there. AGS has held this line
     * since it was written; NRPS did not, which is the bug.
     */
    const following = samePageOrigin(advertised, firstOrigin);
    if (!following) {
      return {
        ok: false,
        reason: 'rejected',
        detail: 'the next page of the roster is not on the same server',
      };
    }
    url = following;
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
    case 'malformed':
      // Said plainly rather than as "no students": an answer AFCT cannot read must never look
      // like a course that has emptied.
      return 'Your LMS sent a roster AFCT could not read, so nothing has been changed. Tell an administrator, who can check the AFCT registration in your LMS.';
    case 'rejected':
    default:
      return 'Your LMS refused to share this course’s roster. Check that AFCT is still installed in that course.';
  }
}
