import { describe, expect, it } from 'vitest';
import { LTI_FRAME_COOKIE, clearFrameMarkerCookie, frameMarkerCookie, framedAuthCookies, hasFrameMarker, isFramedRequest, isTopLevelDocument } from './frame-session';

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

  it('names every cookie, because sharing the Auth.js names locked people out', () => {
    // They used to be unnamed, which left them sharing Auth.js's names with different
    // attributes: the browser then kept both cookies instead of one replacing the other. The
    // naming rules themselves are asserted below.
    for (const cookie of Object.values(cookies)) {
      expect(cookie).toHaveProperty('name');
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

describe('cookies that cannot collide with an ordinary session', () => {
  /**
   * The bug this prevents: the framed cookies used Auth.js's own names with different
   * attributes, so a browser kept both instead of replacing one with the other. Signing in
   * wrote one, the browser went on sending the other, and every page bounced back to the login
   * form until the person cleared cookies for the site.
   */
  it('names every framed cookie differently from the ordinary ones', () => {
    const cookies = framedAuthCookies();
    const names = [
      cookies.sessionToken.name,
      cookies.csrfToken.name,
      cookies.callbackUrl.name,
    ];

    expect(new Set(names).size).toBe(3);
    for (const name of names) {
      expect(name).toContain('afct.framed');
      expect(name).not.toContain('authjs.session-token');
    }
  });

  /** `__Host-` needs Secure and Path=/, which is exactly what Partitioned needs as well. */
  it('keeps the attributes the __Host- prefix requires', () => {
    const cookies = framedAuthCookies();

    for (const cookie of Object.values(cookies)) {
      expect(cookie.name.startsWith('__Host-')).toBe(true);
      expect(cookie.options.secure).toBe(true);
      expect(cookie.options.path).toBe('/');
    }
  });
});

describe('forgetting a frame', () => {
  it('knows a page opened in its own tab from one loaded into a frame', () => {
    expect(isTopLevelDocument(new Headers({ 'sec-fetch-dest': 'document' }))).toBe(true);
    expect(isTopLevelDocument(new Headers({ 'sec-fetch-dest': 'iframe' }))).toBe(false);
    expect(isTopLevelDocument(new Headers({ 'sec-fetch-dest': 'empty' }))).toBe(false);
    expect(isTopLevelDocument(new Headers())).toBe(false);
  });

  it('expires the marker with the attributes it was set with, or it would not match', () => {
    const cleared = clearFrameMarkerCookie();

    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Partitioned');
    expect(cleared).toContain('SameSite=None');
    expect(cleared).toContain('Path=/');
  });
});
