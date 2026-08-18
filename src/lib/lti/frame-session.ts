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
 */

/** Present only inside a framed launch, because that is the only place it can be set. */
export const LTI_FRAME_COOKIE = 'afct.lti-frame';

/** Long enough to outlive a launch and a working session; not a login, so not longer. */
const FRAME_COOKIE_MAX_AGE_S = 24 * 60 * 60;

/** Whether this request is a document being loaded into somebody else's frame. */
export function isFramedRequest(headers: Headers): boolean {
  return headers.get('sec-fetch-dest') === 'iframe';
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

/**
 * Auth.js cookie options for a request inside a framed launch.
 *
 * Only the three cookies a sign-in needs are widened: the session itself, the CSRF token the
 * sign-in POST is checked against, and the callback URL Auth.js round-trips. The OAuth state,
 * nonce and PKCE cookies are deliberately left alone, because institutional sign-in never runs
 * inside an LMS frame and widening them would be a change nobody asked for.
 *
 * Names are omitted so Auth.js keeps its own, which depend on whether the deployment is https;
 * the config is merged into its defaults rather than replacing them.
 */
export function framedAuthCookies() {
  const options = { sameSite: 'none', secure: true, partitioned: true, path: '/' } as const;
  return {
    sessionToken: { options: { ...options, httpOnly: true } },
    csrfToken: { options: { ...options, httpOnly: true } },
    callbackUrl: { options: { ...options, httpOnly: false } },
  };
}
