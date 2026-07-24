import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { POST } from './route';
import { routeCtx } from '@/test/route';
import {
  evaluateCheckEmailRateLimit,
  listRestrictedIps,
  __dangerousResetRateLimiter,
} from '@/lib/security/rate-limiter';

beforeEach(() => {
  vi.clearAllMocks();
  __dangerousResetRateLimiter();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  activityLogMock.mockResolvedValue(undefined);
});

const req = (body: unknown) =>
  new Request('http://localhost/api/admin/status/rate-limits/clear', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const block = (ip: string) => {
  for (let i = 0; i < 31; i++) evaluateCheckEmailRateLimit({ ip });
};

const clearBody = { scope: 'check-email:ip', ip: '203.0.113.9' };

describe('POST /api/admin/status/rate-limits/clear', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(req(clearBody), routeCtx())).status).toBe(401);
  });

  it('403 for a non-admin, and the restriction stays in force', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    block(clearBody.ip);

    expect((await POST(req(clearBody), routeCtx())).status).toBe(403);
    expect(listRestrictedIps()).toHaveLength(1);
  });

  it('400 on an unknown scope', async () => {
    const res = await POST(req({ scope: 'login:account', ip: 'x@example.edu' }), routeCtx());
    expect(res.status).toBe(400);
  });

  it('clears the restriction and logs the administrator, address and time', async () => {
    block(clearBody.ip);

    const res = await POST(req(clearBody), routeCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(listRestrictedIps()).toEqual([]);

    expect(activityLogMock).toHaveBeenCalledTimes(1);
    const logged = activityLogMock.mock.calls[0]![2];
    expect(logged).toMatchObject({
      userId: 'admin-1',
      action: 'CLEAR_RATE_LIMIT',
      severity: 'SECURITY',
      category: 'SYSTEM',
    });
    expect(logged.metadata).toMatchObject({
      targetIp: clearBody.ip,
      scope: 'check-email:ip',
      state: 'blocked',
    });
    // The log helper stamps the timestamp itself; what this route owes it is the
    // restriction's own clock, so the entry is reconstructable after the fact.
    expect(Date.parse(logged.metadata.startedAt)).not.toBeNaN();
    expect(Date.parse(logged.metadata.wouldHaveExpiredAt)).not.toBeNaN();
  });

  it('404 (and no log) when the address is not currently restricted', async () => {
    const res = await POST(req(clearBody), routeCtx());
    expect(res.status).toBe(404);
    expect(activityLogMock).not.toHaveBeenCalled();
  });
});
