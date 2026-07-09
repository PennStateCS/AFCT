import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({ activityLog: { findMany: vi.fn() } }));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  prismaMock.activityLog.findMany.mockResolvedValue([]);
});

const req = () => new Request('http://localhost/api/admin/status/sessions');

describe('GET /api/admin/status/sessions', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });

  it('403 for a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    expect((await GET(req())).status).toBe(403);
  });

  it('returns an empty session set when there is no recent activity', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.activeSessions).toEqual([]);
    expect(body.summary.total24h).toBe(0);
  });

  it('dedups and caps active sessions at 200, counting rolling windows', async () => {
    const nowIso = new Date().toISOString();
    prismaMock.activityLog.findMany.mockResolvedValue(
      Array.from({ length: 205 }, (_, i) => ({
        userId: `user-${i}`,
        metadata: { email: `user-${i}@example.com` },
        ipAddress: `10.0.0.${i}`,
        userAgent: `ua-${i}`,
        timestamp: nowIso,
      })),
    );

    const res = await GET(req());
    const body = await res.json();
    expect(body.activeSessions).toHaveLength(200);
    expect(body.summary.total24h).toBe(205);
    expect(body.summary.uniqUsers24h).toBe(200);
    expect(body.summary.last5m).toBe(200);
  });
});
