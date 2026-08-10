import { NextResponse } from 'next/server';
import { beginLaunch, loginInitRefusalMessage, LTI_STATE_COOKIE } from '@/lib/lti/login-init';
import type { LoginInitParams } from '@/lib/lti/login-init';
import { publicUrl } from '@/lib/lti/public-url';

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
  };
}

async function handle(request: Request, params: LoginInitParams) {
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

  const response = NextResponse.redirect(result.redirectUrl, 302);

  /**
   * The state cookie, which is what ties the returning launch to this browser.
   *
   * `SameSite=None` because the launch is posted back from the LMS, which is a different site;
   * anything stricter and the cookie is simply not sent and every launch fails. That makes it a
   * third-party cookie, so it is also `Partitioned` (CHIPS), which is what keeps browsers that
   * block third-party cookies from dropping it.
   *
   * Partitioned is not sufficient everywhere, and this is the known gap: a browser that blocks
   * it outright needs LTI's own postMessage storage, or a break-out to a top-level window. That
   * is deliberately not built yet, and it is the piece to test in Safari first.
   */
  response.cookies.set(LTI_STATE_COOKIE, result.state, {
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
