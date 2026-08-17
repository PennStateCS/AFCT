import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getTokenMock = vi.hoisted(() => vi.fn());
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }));

const findManyMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ prisma: { ltiPlatform: { findMany: findManyMock } } }));

import { proxy, resetFrameAncestorCache } from './proxy';

const req = (path: string) => new NextRequest(new URL(`http://localhost${path}`));

beforeEach(() => {
  vi.clearAllMocks();
  resetFrameAncestorCache();
  findManyMock.mockResolvedValue([]);
});

/** The frame-ancestors list out of whichever CSP header the response carries. */
const frameAncestors = (res: Response): string => {
  const csp =
    res.headers.get('content-security-policy') ??
    res.headers.get('content-security-policy-report-only') ??
    '';
  return (csp.split(';').find((part) => part.trim().startsWith('frame-ancestors')) ?? '').trim();
};

describe('proxy', () => {
  /**
   * NextAuth names the session cookie from the URL scheme: on https it uses the `__Secure-`
   * prefix. Reading that from NODE_ENV instead means an https deployment that is not a
   * production build looks signed out to the edge, and every API call 401s while pages keep
   * working, because pages read the cookie server-side rather than here. That combination is
   * genuinely confusing to debug, which is why it is pinned.
   */
  describe('which session cookie it looks for', () => {
    const original = process.env.NEXTAUTH_URL;
    afterEach(() => {
      if (original === undefined) delete process.env.NEXTAUTH_URL;
      else process.env.NEXTAUTH_URL = original;
    });

    it('expects the secure cookie when the app is served over https', async () => {
      process.env.NEXTAUTH_URL = 'https://afct.example.edu';
      getTokenMock.mockResolvedValue({ isAdmin: false });

      await proxy(req('/api/courses'));

      expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: true }));
    });

    it('expects the plain cookie over http', async () => {
      process.env.NEXTAUTH_URL = 'http://localhost:3000';
      getTokenMock.mockResolvedValue({ isAdmin: false });

      await proxy(req('/api/courses'));

      expect(getTokenMock).toHaveBeenCalledWith(expect.objectContaining({ secureCookie: false }));
    });
  });
  describe('/api/admin/*', () => {
    it('403s a positively-confirmed non-admin', async () => {
      getTokenMock.mockResolvedValue({ isAdmin: false });
      const res = await proxy(req('/api/admin/users'));
      expect(res.status).toBe(403);
    });

    it('passes an admin through', async () => {
      getTokenMock.mockResolvedValue({ isAdmin: true });
      const res = await proxy(req('/api/admin/users'));
      expect(res.status).toBe(200); // NextResponse.next()
    });

    it('falls through (does not lock out) when the token is missing/undecodable', async () => {
      getTokenMock.mockResolvedValue(null);
      const res = await proxy(req('/api/admin/users'));
      // Not a 401/redirect: the route's own isAdmin check decides.
      expect(res.status).toBe(200);
    });
  });

  describe('authenticated data APIs', () => {
    it('401s an unauthenticated request', async () => {
      getTokenMock.mockResolvedValue(null);
      const res = await proxy(req('/api/courses/c1'));
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    });

    it('passes a signed-in request through (authorization happens in the route)', async () => {
      getTokenMock.mockResolvedValue({ id: 'u1', isAdmin: false });
      const res = await proxy(req('/api/courses/c1'));
      expect(res.status).toBe(200);
    });

    it('covers the bare /api/courses collection', async () => {
      getTokenMock.mockResolvedValue(null);
      expect((await proxy(req('/api/courses'))).status).toBe(401);
    });
  });

  describe('public API allowlist', () => {
    it.each([
      '/api/auth/session',
      '/api/auth/signup',
      '/api/health',
      '/api/system-settings/public',
      // Fetched by an LMS's servers, which have no AFCT session and never will.
      '/api/lti/jwks',
      // The launch round trip. Nobody is signed in yet, which is the point of it.
      '/api/lti/login',
      '/api/lti/launch',
    ])('lets %s through without reading a token', async (path) => {
      const res = await proxy(req(path));
      expect(res.status).toBe(200);
      // Public routes short-circuit before the JWT read.
      expect(getTokenMock).not.toHaveBeenCalled();
    });

    it('does not treat a lookalike prefix as public (/api/healthz)', async () => {
      getTokenMock.mockResolvedValue(null);
      const res = await proxy(req('/api/healthz'));
      expect(res.status).toBe(401);
    });

    /**
     * Only the named LTI entry points are public. An allowlist entry of `/api/lti` would have
     * quietly opened the platform registration routes that live alongside them.
     */
    it('does not make the rest of /api/lti public', async () => {
      getTokenMock.mockResolvedValue(null);

      expect((await proxy(req('/api/lti/platforms'))).status).toBe(401);
    });
  });

  describe('deny-by-default (fail-closed)', () => {
    it('401s an unauthenticated request to a route not on the allowlist', async () => {
      // A brand-new authed route family is gated automatically, no matcher edit.
      getTokenMock.mockResolvedValue(null);
      const res = await proxy(req('/api/reports/monthly'));
      expect(res.status).toBe(401);
    });

    it('passes it through once signed in', async () => {
      getTokenMock.mockResolvedValue({ id: 'u1' });
      const res = await proxy(req('/api/reports/monthly'));
      expect(res.status).toBe(200);
    });
  });

  describe('/dashboard/* pages', () => {
    it('redirects an unauthenticated visitor to /login with a callbackUrl', async () => {
      getTokenMock.mockResolvedValue(null);
      const res = await proxy(req('/dashboard/courses/c1'));
      expect(res.status).toBe(307);
      const location = res.headers.get('location') ?? '';
      expect(location).toContain('/login');
      expect(location).toContain('callbackUrl=%2Fdashboard%2Fcourses%2Fc1');
    });

    it('preserves the query string in the callbackUrl (e.g. a join link)', async () => {
      getTokenMock.mockResolvedValue(null);
      const res = await proxy(req('/dashboard?joinCode=ABCD2345'));
      const location = res.headers.get('location') ?? '';
      expect(location).toContain('/login');
      // Full path + query, URL-encoded, so ?joinCode= survives the login bounce.
      expect(location).toContain('callbackUrl=%2Fdashboard%3FjoinCode%3DABCD2345');
    });

    it('passes a signed-in visitor through', async () => {
      getTokenMock.mockResolvedValue({ id: 'u1' });
      const res = await proxy(req('/dashboard/courses/c1'));
      expect(res.status).toBe(200);
    });
  });

  describe('content-security-policy', () => {
    const cspOf = (res: Response) => res.headers.get('content-security-policy-report-only') ?? '';

    it('sets a report-only CSP with a per-request nonce on a public page (no token read)', async () => {
      const res = await proxy(req('/login'));
      expect(res.status).toBe(200);
      expect(getTokenMock).not.toHaveBeenCalled();
      const csp = cspOf(res);
      expect(csp).toMatch(/script-src[^;]*'nonce-[^']+'/);
      expect(csp).toContain("'strict-dynamic'");
      // The old weakness: inline scripts must no longer be allowed.
      expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    });

    it('gives each request a fresh nonce', async () => {
      const a = cspOf(await proxy(req('/login')));
      const b = cspOf(await proxy(req('/login')));
      const nonceOf = (csp: string) => csp.match(/'nonce-([^']+)'/)?.[1];
      expect(nonceOf(a)).toBeTruthy();
      expect(nonceOf(a)).not.toBe(nonceOf(b));
    });

    it('attaches the CSP to authenticated pass-through responses too', async () => {
      getTokenMock.mockResolvedValue({ id: 'u1' });
      const res = await proxy(req('/dashboard/courses/c1'));
      expect(res.status).toBe(200);
      expect(cspOf(res)).toMatch(/'nonce-[^']+'/);
    });
  });

  describe('idle-timeout enforcement', () => {
    const IDLE = 20 * 60_000;
    const expired = { id: 'u1', lastActivity: Date.now() - IDLE - 5_000, idleTimeoutMs: IDLE };
    const fresh = { id: 'u1', lastActivity: Date.now() - 1_000, idleTimeoutMs: IDLE };

    it('401s an idle-expired token on an API route', async () => {
      getTokenMock.mockResolvedValue(expired);
      const res = await proxy(req('/api/courses/c1'));
      expect(res.status).toBe(401);
    });

    it('redirects an idle-expired token on a page route', async () => {
      getTokenMock.mockResolvedValue(expired);
      const res = await proxy(req('/dashboard/courses/c1'));
      expect(res.status).toBe(307);
      expect(res.headers.get('location') ?? '').toContain('/login');
    });

    it('401s an idle-expired admin on an admin route (idle beats the admin check)', async () => {
      getTokenMock.mockResolvedValue({ ...expired, isAdmin: true });
      const res = await proxy(req('/api/admin/users'));
      expect(res.status).toBe(401);
    });

    it('passes a fresh (recently-active) token through', async () => {
      getTokenMock.mockResolvedValue(fresh);
      expect((await proxy(req('/api/courses/c1'))).status).toBe(200);
    });

    it('does not idle-check a legacy token without activity fields', async () => {
      getTokenMock.mockResolvedValue({ id: 'u1' });
      expect((await proxy(req('/api/courses/c1'))).status).toBe(200);
    });
  });

  /**
   * An LMS embeds its tools, and Canvas's deep-linking picker is a modal iframe with no way to
   * open a new tab. `frame-ancestors 'self'` therefore does not merely inconvenience deep
   * linking, it makes it impossible. The answer is to name the platforms an administrator has
   * registered, and only where an LMS actually frames us.
   */
  describe('who may put AFCT in an iframe', () => {
    const platform = {
      authLoginUrl: 'https://canvas.school.edu/api/lti/authorize_redirect',
      tokenUrl: 'https://canvas.school.edu/login/oauth2/token',
      keysetUrl: 'https://canvas.school.edu/api/lti/security/jwks',
    };

    it('lets a registered platform frame the LTI routes', async () => {
      findManyMock.mockResolvedValue([platform]);

      const res = await proxy(req('/lti/deep-link'));

      expect(frameAncestors(res)).toBe("frame-ancestors 'self' https://canvas.school.edu");
    });

    it('keeps every other page unframeable, however many platforms are registered', async () => {
      findManyMock.mockResolvedValue([platform]);

      const res = await proxy(req('/login'));

      expect(frameAncestors(res)).toBe("frame-ancestors 'self'");
      // The lookup is skipped entirely rather than merely ignored.
      expect(findManyMock).not.toHaveBeenCalled();
    });

    it('names the platform by where it answers, not by the issuer it reports', async () => {
      // A self-hosted Canvas reports the issuer https://canvas.instructure.com while living
      // somewhere else entirely. Trusting the issuer would allow an origin that never calls.
      findManyMock.mockResolvedValue([platform]);

      const res = await proxy(req('/api/lti/login'));

      expect(frameAncestors(res)).not.toContain('canvas.instructure.com');
      expect(frameAncestors(res)).toContain('https://canvas.school.edu');
    });

    it('falls back to self when the database cannot be read', async () => {
      findManyMock.mockRejectedValue(new Error('connection refused'));

      const res = await proxy(req('/lti/link'));

      // Fails closed: deep linking stops working, nothing becomes frameable.
      expect(frameAncestors(res)).toBe("frame-ancestors 'self'");
    });

    it('ignores a stored URL that will not parse rather than refusing every launch', async () => {
      findManyMock.mockResolvedValue([{ ...platform, tokenUrl: 'not a url' }]);

      const res = await proxy(req('/lti/deep-link'));

      expect(frameAncestors(res)).toBe("frame-ancestors 'self' https://canvas.school.edu");
    });

    it('reads the platforms once for a burst of launches rather than once per request', async () => {
      findManyMock.mockResolvedValue([platform]);

      await proxy(req('/lti/deep-link'));
      await proxy(req('/lti/deep-link'));
      await proxy(req('/api/lti/login'));

      expect(findManyMock).toHaveBeenCalledTimes(1);
    });

    /**
     * Automatic registration is the case the registered-platforms list cannot cover: the LMS
     * frames the registration page precisely because it is not registered yet.
     */
    describe('an LMS registering itself', () => {
      it('may frame the registration page it was sent to', async () => {
        findManyMock.mockResolvedValue([]);

        const res = await proxy(
          req('/lti/register?rt=abc&openid_configuration=https://new-lms.school.edu/.well-known/x'),
        );

        expect(frameAncestors(res)).toBe("frame-ancestors 'self' https://new-lms.school.edu");
      });

      it('gets no such licence on any other page', async () => {
        findManyMock.mockResolvedValue([]);

        const res = await proxy(
          req('/lti/launch?openid_configuration=https://new-lms.school.edu/.well-known/x'),
        );

        expect(frameAncestors(res)).toBe("frame-ancestors 'self'");
      });

      it('ignores an origin that is not https, or is not a URL at all', async () => {
        findManyMock.mockResolvedValue([]);

        for (const value of ['http://new-lms.school.edu/x', 'not a url']) {
          const res = await proxy(req(`/lti/register?openid_configuration=${value}`));
          expect(frameAncestors(res)).toBe("frame-ancestors 'self'");
        }
      });
    });
  });
});
