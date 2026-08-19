/**
 * Making a session work when AFCT is inside somebody else's page.
 *
 * Canvas, Brightspace and Blackboard all embed a tool in an iframe by default, and in that
 * position every request AFCT makes to itself is third-party as far as the browser is
 * concerned: the "site for cookies" is the LMS, not AFCT. `SameSite=Lax`, which is what Auth.js
 * uses and what is right for an ordinary sign-in, means those cookies are simply not sent. The
 * symptom is exact and was seen on prod: the launch completes, the page then asks for a CSRF
 * token, the cookie behind it never arrives, and Auth.js answers `MissingCSRF`. The person is
 * told AFCT could not open, having done nothing wrong.
 *
 * The fix is not to loosen the cookies for everybody. `SameSite=None` on the session cookie
 * app-wide would put every ordinary user's session in reach of any site that can make their
 * browser issue a request, to solve a problem only launches have. So the looser attributes are
 * used **only** for requests that are actually inside a framed launch, and they are partitioned
 * (CHIPS), which keys the cookie to the embedding site: a session established inside Canvas's
 * frame exists only in Canvas's partition, and cannot be read from any other site's frame or
 * from ordinary top-level browsing.
 *
 * How a request is known to be in a framed launch: the edge marks it. A browser tells us
 * `Sec-Fetch-Dest: iframe` on the document request that loads AFCT into the frame, which is the
 * one moment the fact is visible; from then on the fetches AFCT makes to itself look
 * same-origin and say nothing about who is embedding. So that first request drops a marker
 * cookie, itself partitioned, and its presence on later requests is what says "still in a
 * frame". Nothing else is trusted for it: the marker cannot be planted cross-origin, and even
 * if it were, it only changes which partition a session lands in.
 *
 * Not a complete answer on its own. Safari refuses third-party cookie writes outright unless
 * the tool has been granted storage access, so a launch there can still fail; the launch page
 * offers a new tab for that case, which is first-party and always works.
 *
 * ## Why the framed cookies have names of their own
 *
 * They used to reuse Auth.js's names with different attributes, which locked somebody out of
 * AFCT entirely. A browser keys a cookie by name, domain and path, and treats a partitioned one
 * as separate storage, so the two did not replace each other: signing in wrote one while the
 * browser went on sending the other, the edge read one and the app read the other, and every
 * sign-in succeeded and every page bounced back to the login form. The only way out was
 * clearing cookies for the site, which nobody would guess.
 *
 * Distinct names make that impossible rather than unlikely: a framed session and an ordinary
 * one are different cookies, both can exist, and each context reads its own.
 */

/** Present only inside a framed launch, because that is the only place it can be set. */
export const LTI_FRAME_COOKIE = 'afct.lti-frame';

/** Long enough to outlive a launch and a working session; not a login, so not longer. */
const FRAME_COOKIE_MAX_AGE_S = 24 * 60 * 60;

/** Whether this request is a document being loaded into somebody else's frame. */
export function isFramedRequest(headers: Headers): boolean {
  return headers.get('sec-fetch-dest') === 'iframe';
}

/**
 * Whether this request is a page being loaded at the top level, in its own tab or window.
 *
 * A browser says `document` for a normal navigation and `iframe` for one into a frame, so this
 * is the moment AFCT can tell it is *not* embedded any more, and the moment to forget it ever
 * was. Without it the marker outlives the launch and quietly changes how ordinary browsing is
 * treated for the rest of the day.
 */
export function isTopLevelDocument(headers: Headers): boolean {
  return headers.get('sec-fetch-dest') === 'document';
}

/** Whether AFCT is already known to be framed, from the marker set on the way in. */
export function hasFrameMarker(cookieHeader: string | null | undefined): boolean {
  if (!cookieHeader) return false;
  // Matched at a boundary so `not-afct.lti-frame` cannot pass for it.
  return new RegExp(`(?:^|;\\s*)${LTI_FRAME_COOKIE.replace('.', '\\.')}=1(?:;|$)`).test(
    cookieHeader,
  );
}

/**
 * The marker, as a `Set-Cookie` value.
 *
 * `Partitioned` is what keeps this honest: the marker exists per embedding site, so leaving one
 * LMS does not leave AFCT believing it is framed by another.
 */
export function frameMarkerCookie(): string {
  return [
    `${LTI_FRAME_COOKIE}=1`,
    'Path=/',
    'SameSite=None',
    'Secure',
    'Partitioned',
    'HttpOnly',
    `Max-Age=${FRAME_COOKIE_MAX_AGE_S}`,
  ].join('; ');
}

/** Expire the marker, for a page that has just been opened outside any frame. */
export function clearFrameMarkerCookie(): string {
  return [
    `${LTI_FRAME_COOKIE}=`,
    'Path=/',
    'SameSite=None',
    'Secure',
    'Partitioned',
    'HttpOnly',
    'Max-Age=0',
  ].join('; ');
}

/**
 * The names a framed session's cookies use.
 *
 * `__Host-` because these only ever exist on https (an LMS will not embed anything else) and
 * the prefix is what stops a subdomain writing one. Partitioned needs the same two properties
 * the prefix enforces, `Secure` and `Path=/`, so the two agree by construction.
 */
export const FRAMED_COOKIE_NAMES = {
  sessionToken: '__Host-afct.framed.session-token',
  csrfToken: '__Host-afct.framed.csrf-token',
  callbackUrl: '__Host-afct.framed.callback-url',
} as const;

/**
 * Auth.js cookie options for a request inside a framed launch.
 *
 * Only the three cookies a sign-in needs are widened: the session itself, the CSRF token the
 * sign-in POST is checked against, and the callback URL Auth.js round-trips. The OAuth state,
 * nonce and PKCE cookies are deliberately left alone, because institutional sign-in never runs
 * inside an LMS frame and widening them would be a change nobody asked for.
 *
 * The names are AFCT's own rather than Auth.js's defaults, so a framed session and an ordinary
 * one are separate cookies that cannot overwrite or shadow each other. See the note at the top
 * of this file for what happened when they shared names.
 */
export function framedAuthCookies() {
  const options = { sameSite: 'none', secure: true, partitioned: true, path: '/' } as const;
  return {
    sessionToken: { name: FRAMED_COOKIE_NAMES.sessionToken, options: { ...options, httpOnly: true } },
    csrfToken: { name: FRAMED_COOKIE_NAMES.csrfToken, options: { ...options, httpOnly: true } },
    callbackUrl: {
      name: FRAMED_COOKIE_NAMES.callbackUrl,
      options: { ...options, httpOnly: false },
    },
  };
}
