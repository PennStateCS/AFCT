import { describe, expect, it } from 'vitest';
import {
  LTI_FRAME_COOKIE,
  frameMarkerCookie,
  framedAuthCookies,
  hasFrameMarker,
  isFramedRequest,
} from './frame-session';

/**
 * The cookies a launch needs when AFCT is inside an LMS page.
 *
 * The reason this exists at all is a failure seen on prod: framed launches died with
 * `MissingCSRF`, because `SameSite=Lax` cookies are not sent from a third-party frame. What is
 * pinned here is that the looser attributes are reachable only from a framed launch, and that
 * they are partitioned, since an unpartitioned `SameSite=None` session cookie is the thing that
 * would trade one bug for a worse one.
 */

describe('spotting a framed launch', () => {
  it('reads the one header that says so', () => {
    expect(isFramedRequest(new Headers({ 'sec-fetch-dest': 'iframe' }))).toBe(true);
    expect(isFramedRequest(new Headers({ 'sec-fetch-dest': 'document' }))).toBe(false);
    // Absent on older browsers: treated as not framed, which keeps the strict cookies.
    expect(isFramedRequest(new Headers())).toBe(false);
  });

  it('recognises its own marker and nothing else', () => {
    expect(hasFrameMarker(`${LTI_FRAME_COOKIE}=1`)).toBe(true);
    expect(hasFrameMarker(`a=b; ${LTI_FRAME_COOKIE}=1; c=d`)).toBe(true);
    expect(hasFrameMarker(null)).toBe(false);
    expect(hasFrameMarker('a=b')).toBe(false);
    // A cookie whose name merely ends with the marker's must not pass for it.
    expect(hasFrameMarker(`not-${LTI_FRAME_COOKIE}=1`)).toBe(false);
  });
});

describe('the marker cookie', () => {
  it('is partitioned, so it belongs to the site doing the embedding', () => {
    const cookie = frameMarkerCookie();

    // Without Partitioned, one LMS framing AFCT would leave AFCT believing it is framed
    // everywhere, including in another LMS's frame and in ordinary browsing.
    expect(cookie).toContain('Partitioned');
    expect(cookie).toContain('SameSite=None');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
  });
});

describe('the sign-in cookies inside a frame', () => {
  const cookies = framedAuthCookies();

  it('are partitioned rather than simply loosened', () => {
    for (const [name, cookie] of Object.entries(cookies)) {
      expect(cookie.options.sameSite, name).toBe('none');
      expect(cookie.options.secure, name).toBe(true);
      // The whole point: a session made inside Canvas's frame lives in Canvas's partition and
      // cannot be read from another site's frame, or from a normal tab.
      expect(cookie.options.partitioned, name).toBe(true);
    }
  });

  it('keeps the session and CSRF cookies away from scripts', () => {
    expect(cookies.sessionToken.options.httpOnly).toBe(true);
    expect(cookies.csrfToken.options.httpOnly).toBe(true);
  });

  it('names no cookies, so Auth.js keeps its own for the deployment', () => {
    // Naming them here would drop the `__Secure-` prefixes Auth.js chooses on https.
    for (const cookie of Object.values(cookies)) {
      expect(cookie).not.toHaveProperty('name');
    }
  });

  it('leaves the OAuth cookies alone', () => {
    // Institutional sign-in never runs inside an LMS frame, so widening state, nonce or PKCE
    // would be a loosening nobody asked for.
    expect(cookies).not.toHaveProperty('state');
    expect(cookies).not.toHaveProperty('nonce');
    expect(cookies).not.toHaveProperty('pkceCodeVerifier');
  });
});
