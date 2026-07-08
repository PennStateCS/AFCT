import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getTokenMock = vi.hoisted(() => vi.fn());
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }));

import { middleware } from './middleware';

const req = (path: string) => new NextRequest(new URL(`http://localhost${path}`));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('middleware', () => {
  describe('/api/admin/*', () => {
    it('403s a positively-confirmed non-admin', async () => {
      getTokenMock.mockResolvedValue({ isAdmin: false });
      const res = await middleware(req('/api/admin/users'));
      expect(res.status).toBe(403);
    });

    it('passes an admin through', async () => {
      getTokenMock.mockResolvedValue({ isAdmin: true });
      const res = await middleware(req('/api/admin/users'));
      expect(res.status).toBe(200); // NextResponse.next()
    });

    it('falls through (does not lock out) when the token is missing/undecodable', async () => {
      getTokenMock.mockResolvedValue(null);
      const res = await middleware(req('/api/admin/users'));
      // Not a 401/redirect — the route's own isAdmin check decides.
      expect(res.status).toBe(200);
    });
  });

  describe('authenticated data APIs', () => {
    it('401s an unauthenticated request', async () => {
      getTokenMock.mockResolvedValue(null);
      const res = await middleware(req('/api/courses/c1'));
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
    });

    it('passes a signed-in request through (authorization happens in the route)', async () => {
      getTokenMock.mockResolvedValue({ id: 'u1', isAdmin: false });
      const res = await middleware(req('/api/courses/c1'));
      expect(res.status).toBe(200);
    });

    it('covers the bare /api/courses collection', async () => {
      getTokenMock.mockResolvedValue(null);
      expect((await middleware(req('/api/courses'))).status).toBe(401);
    });
  });

  describe('/dashboard/* pages', () => {
    it('redirects an unauthenticated visitor to /login with a callbackUrl', async () => {
      getTokenMock.mockResolvedValue(null);
      const res = await middleware(req('/dashboard/courses/c1'));
      expect(res.status).toBe(307);
      const location = res.headers.get('location') ?? '';
      expect(location).toContain('/login');
      expect(location).toContain('callbackUrl=%2Fdashboard%2Fcourses%2Fc1');
    });

    it('passes a signed-in visitor through', async () => {
      getTokenMock.mockResolvedValue({ id: 'u1' });
      const res = await middleware(req('/dashboard/courses/c1'));
      expect(res.status).toBe(200);
    });
  });
});
