import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
  activityLog: { count: vi.fn(), groupBy: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSync = vi.fn().mockReturnValue(false);
  return { ...actual, existsSync, default: { ...actual, existsSync } };
});

import { GET } from './route';
import { routeCtx } from '@/test/route';

const envBackup = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...envBackup };
  process.env.DATABASE_URL = 'sqlite://memory';
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.$queryRawUnsafe.mockResolvedValue([]);
  prismaMock.activityLog.count.mockResolvedValue(0);
  prismaMock.activityLog.groupBy.mockResolvedValue([]);
});

const req = () => new Request('http://localhost/api/admin/status/summary');

describe('GET /api/admin/status/summary', () => {
  it('401 / 403 gates', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req(), routeCtx())).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    expect((await GET(req(), routeCtx())).status).toBe(403);
  });

  it('returns the cross-cutting summary numbers with a latency reading', async () => {
    prismaMock.activityLog.count.mockResolvedValue(12);
    prismaMock.activityLog.groupBy.mockResolvedValue([{ userId: 'a' }, { userId: 'b' }]);

    const res = await GET(req(), routeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.db.ok).toBe(true);
    expect(body.db.provider).toBe('sqlite');
    expect(typeof body.uptime).toBe('number');
    expect(body.sessions24h).toBe(12);
    expect(body.uniqueUsers24h).toBe(2);
    expect(typeof body.latencyMs).toBe('number');
  });

  it('reports db.ok:false when the probe fails', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('down'));
    const res = await GET(req(), routeCtx());
    const body = await res.json();
    expect(body.db.ok).toBe(false);
  });
});
