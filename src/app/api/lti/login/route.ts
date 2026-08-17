import { NextResponse } from 'next/server';
import { beginLaunch, loginInitRefusalMessage, stateCookieName } from '@/lib/lti/login-init';
import type { LoginInitParams } from '@/lib/lti/login-init';
import { publicUrl } from '@/lib/lti/public-url';
import {
  evaluateLtiLoginRateLimit,
  formatRetryAfterSeconds,
  getClientIp,
} from '@/lib/security/rate-limiter';

/**
 * Where an LMS sends the browser to start a launch.
 *
 * Public and unauthenticated, necessarily: the whole point is that nobody is signed in yet. It
 * reveals nothing (a redirect to the LMS's own endpoint) and changes nothing except minting a
 * state and nonce that are useless without the LMS then signing a token.
 *
 * Accepts both GET and POST because platforms differ on which they use, and the spec permits
 * both. Canvas uses POST; the 1EdTech reference implementation uses GET.
 */

/** Both verbs carry the same parameters, in different places. */
function paramsFrom(source: URLSearchParams | FormData): LoginInitParams {
  const get = (key: string) => {
    const value = source.get(key);
    return typeof value === 'string' ? value : null;
  };
  return {
    iss: get('iss'),
    login_hint: get('login_hint'),
    target_link_uri: get('target_link_uri'),
    lti_message_hint: get('lti_message_hint'),
    client_id: get('client_id'),
    lti_deployment_id: get('lti_deployment_id'),
    lti_storage_target: get('lti_storage_target'),
  };
}

/** Plain text, because a person reads this inside an LMS frame rather than code. */
function refuse(message: string, status: number, headers: Record<string, string> = {}) {
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...headers },
  });
}

async function handle(request: Request, params: LoginInitParams) {
  // Unauthenticated and it writes rows, so it is capped per address. Generous enough that a
  // class opening an assignment together is unaffected.
  const limit = evaluateLtiLoginRateLimit({ ip: getClientIp(request) });
  if (limit.status === 'blocked') {
    return refuse(
      'Too many launches from this network just now. Try again in a few minutes.',
      429,
      { 'Retry-After': formatRetryAfterSeconds(limit.retryAfterMs) },
    );
  }

  // Built from the configured public URL: the platform compares this literally against the
  // registration, and behind a proxy the request's own host is an internal address.
  const redirectUri = publicUrl('/api/lti/launch', request);
  const result = await beginLaunch({ params, redirectUri });

  if (!result.ok) {
    // Plain text rather than JSON: this is read by a person staring at a failed launch inside an
    // LMS frame, not by code.
    return new NextResponse(loginInitRefusalMessage(result.reason), {
      status: result.reason === 'missing-issuer' ? 400 : 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  /**
   * Where the browser goes next.
   *
   * Straight to the platform when it offered no storage, which is one hop and the behaviour
   * every launch had before. When it did offer storage, through a page of AFCT's own first, so
   * the launch's state is put somewhere a browser that blocks third-party cookies will still
   * keep. The cookie below is set either way and stays the check that actually proves things;
   * the stored copy is only consulted when the cookie does not arrive.
   */
  const destination = result.storageTarget
    ? (() => {
        const url = new URL(publicUrl('/lti/store-state', request));
        url.searchParams.set('state', result.state);
        url.searchParams.set('authorize', result.redirectUrl);
        url.searchParams.set('target', result.storageTarget);
        return url.toString();
      })()
    : result.redirectUrl;

  const response = NextResponse.redirect(destination, 302);

  /**
   * The state cookie, which is what ties the returning launch to this browser.
   *
   * `SameSite=None` because the launch is posted back from the LMS, which is a different site;
   * anything stricter and the cookie is simply not sent and every launch fails. That makes it a
   * third-party cookie, so it is also `Partitioned` (CHIPS), which is what keeps browsers that
   * block third-party cookies from dropping it.
   *
   * Partitioned is not sufficient everywhere: a browser that blocks third-party cookies outright
   * drops this regardless. That is what the platform-storage hop above is for. This cookie stays
   * the primary check, because the browser sends it by itself and no other site can read it or
   * plant it, which is a stronger statement than anything a page can make.
   */
  response.cookies.set(stateCookieName(result.state), result.state, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/api/lti',
    maxAge: 600,
  });

  return response;
}

/**
 * @openapi
 * summary: Start an LTI launch (platforms that initiate with GET)
 * security: []
 * responses:
 *   302: { description: Redirect to the platform's authorization endpoint. }
 *   400: { description: The request did not say which LMS it came from. }
 *   404: { description: "No registration matches, or more than one does." }
 */
export async function GET(request: Request) {
  return handle(request, paramsFrom(new URL(request.url).searchParams));
}

/**
 * @openapi
 * summary: Start an LTI launch (platforms that initiate with POST)
 * security: []
 * responses:
 *   302: { description: Redirect to the platform's authorization endpoint. }
 *   400: { description: The request did not say which LMS it came from. }
 *   404: { description: "No registration matches, or more than one does." }
 */
export async function POST(request: Request) {
  return handle(request, paramsFrom(await request.formData()));
}
