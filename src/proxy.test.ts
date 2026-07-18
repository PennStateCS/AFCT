import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getTokenMock = vi.hoisted(() => vi.fn());
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }));

import { proxy } from './proxy';

const req = (path: string) => new NextRequest(new URL(`http://localhost${path}`));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('proxy', () => {
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
});
