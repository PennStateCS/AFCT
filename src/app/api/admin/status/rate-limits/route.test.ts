import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET } from './route';
import { routeCtx } from '@/test/route';
import {
  evaluateCheckEmailRateLimit,
  evaluateLoginRateLimit,
  __dangerousResetRateLimiter,
} from '@/lib/security/rate-limiter';

beforeEach(() => {
  vi.clearAllMocks();
  __dangerousResetRateLimiter();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
});

const req = () => new Request('http://localhost/api/admin/status/rate-limits');

describe('GET /api/admin/status/rate-limits', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req(), routeCtx())).status).toBe(401);
  });

  it('403 for a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    expect((await GET(req(), routeCtx())).status).toBe(403);
  });

  it('returns an empty list when nothing is restricted', async () => {
    const res = await GET(req(), routeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toEqual([]);
    expect(typeof body.generatedAt).toBe('number');
  });

  it('reports a restricted address with its reason and expiry', async () => {
    for (let i = 0; i < 31; i++) evaluateCheckEmailRateLimit({ ip: '203.0.113.5' });

    const body = await (await GET(req(), routeCtx())).json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]).toMatchObject({
      ip: '203.0.113.5',
      scope: 'check-email:ip',
      state: 'blocked',
      reason: 'Too many email availability checks from this address',
    });
    expect(body.entries[0].expiresAt).toBeGreaterThan(body.generatedAt);
  });

  it('does not leak the buckets keyed on an account rather than an address', async () => {
    const identifier = 'student@example.edu';
    evaluateLoginRateLimit({ identifier, accountLimit: { maxAttempts: 1 } });
    evaluateLoginRateLimit({ identifier, accountLimit: { maxAttempts: 1 } });

    const body = await (await GET(req(), routeCtx())).json();
    expect(body.entries).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(identifier);
  });
});
