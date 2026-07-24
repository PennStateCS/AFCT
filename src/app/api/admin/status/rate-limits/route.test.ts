import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  activityLog: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
}));
const dnsReverseMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('dns', () => ({ promises: { reverse: dnsReverseMock } }));

import { GET } from './route';
import { routeCtx } from '@/test/route';
import {
  evaluateCheckEmailRateLimit,
  evaluateLoginRateLimit,
  __dangerousResetRateLimiter,
} from '@/lib/security/rate-limiter';
import { __clearPtrCache } from '@/lib/status/rate-limits';

beforeEach(() => {
  vi.clearAllMocks();
  __dangerousResetRateLimiter();
  __clearPtrCache();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  prismaMock.activityLog.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);
  dnsReverseMock.mockResolvedValue([]);
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

  it('adds the reverse-DNS name and classification of the address', async () => {
    dnsReverseMock.mockResolvedValue(['lab-12.cs.example.edu']);
    for (let i = 0; i < 31; i++) evaluateCheckEmailRateLimit({ ip: '203.0.113.5' });

    const body = await (await GET(req(), routeCtx())).json();
    expect(body.entries[0].details).toMatchObject({
      version: 4,
      kind: 'public',
      kindLabel: 'Public internet address',
      hostname: 'lab-12.cs.example.edu',
      hostnameLookup: 'ok',
    });
  });

  it('skips the reverse lookup for an address that cannot have a useful name', async () => {
    for (let i = 0; i < 31; i++) evaluateCheckEmailRateLimit({ ip: '10.1.2.3' });

    const body = await (await GET(req(), routeCtx())).json();
    expect(dnsReverseMock).not.toHaveBeenCalled();
    expect(body.entries[0].details).toMatchObject({
      kind: 'private',
      hostnameLookup: 'skipped',
    });
  });

  it('reports what the activity log knows about the address', async () => {
    const seen = new Date('2026-07-20T12:00:00.000Z');
    prismaMock.activityLog.findMany.mockResolvedValue([
      { ipAddress: '203.0.113.5', userId: 'u1', timestamp: seen },
      { ipAddress: '203.0.113.5', userId: 'u2', timestamp: seen },
      { ipAddress: '203.0.113.5', userId: 'u1', timestamp: seen },
    ]);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'a@example.edu', name: 'A' },
      { id: 'u2', email: 'b@example.edu', name: 'B' },
    ]);
    for (let i = 0; i < 31; i++) evaluateCheckEmailRateLimit({ ip: '203.0.113.5' });

    const body = await (await GET(req(), routeCtx())).json();
    expect(body.entries[0].details.knownActivity).toMatchObject({
      eventCount: 3,
      accountCount: 2,
      windowDays: 30,
      truncated: false,
    });
    expect(body.entries[0].details.knownActivity.accounts).toEqual([
      'a@example.edu',
      'b@example.edu',
    ]);
  });

  it('still lists the restriction when the activity lookup fails', async () => {
    prismaMock.activityLog.findMany.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (let i = 0; i < 31; i++) evaluateCheckEmailRateLimit({ ip: '203.0.113.5' });

    const res = await GET(req(), routeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].details.knownActivity).toBeNull();
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
