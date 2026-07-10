import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));

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
});

const req = () => new Request('http://localhost/api/admin/status/database');

describe('GET /api/admin/status/database', () => {
  it('401 / 403 gates', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req(), routeCtx())).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    expect((await GET(req(), routeCtx())).status).toBe(403);
  });

  it('reports reachable + provider for a working DB', async () => {
    const res = await GET(req(), routeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('sqlite');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('reports ok:false with a message when the DB is unreachable', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('Connection failed'));
    const res = await GET(req(), routeCtx());
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.message).toContain('failed');
  });

  it('enumerates sqlite tables across attached databases', async () => {
    prismaMock.$queryRawUnsafe.mockImplementation(async (query: unknown) => {
      const sql = String(query ?? '');
      if (sql.includes('PRAGMA database_list')) return [{ seq: 0, name: 'main' }];
      if (sql.includes('sqlite_schema') && sql.includes('SELECT name FROM'))
        return [{ name: 'Users' }, { name: 'Courses' }];
      return [];
    });
    const res = await GET(req(), routeCtx());
    const body = await res.json();
    expect(body.details.table_names).toEqual(['Users', 'Courses']);
    expect(body.details.table_count).toBe(2);
  });
});
