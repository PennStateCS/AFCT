import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const tlsConnectMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  activityLog: { count: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('dns', () => ({ promises: { lookup: vi.fn().mockResolvedValue([]) } }));
vi.mock('tls', () => ({ connect: tlsConnectMock }));

import { GET } from './route';
import { clearStatusCache } from '@/lib/status/cache';

const envBackup = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  clearStatusCache();
  process.env = { ...envBackup };
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  prismaMock.$queryRaw.mockResolvedValue([{ num_backends: 3 }]);
  prismaMock.activityLog.count.mockResolvedValue(0);
  tlsConnectMock.mockImplementation((_o: unknown, onSecure: () => void) => {
    const socket = {
      getPeerCertificate: () => ({ valid_to: 'Jan 01 2030 00:00:00 GMT' }),
      end: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(() => socket),
    };
    queueMicrotask(() => onSecure());
    return socket;
  });
  (globalThis as { fetch?: typeof fetch }).fetch = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 }));
});

const req = () => new Request('http://localhost/api/admin/status/network');

describe('GET /api/admin/status/network', () => {
  it('401 / 403 gates', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    expect((await GET(req())).status).toBe(403);
  });

  it('returns db/auth/error diagnostics', async () => {
    process.env.NEXTAUTH_URL = 'https://auth.example.com';
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.db.host).toBe('localhost');
    expect(body.db.connections).toBe(3);
    expect(body.auth.host).toBe('auth.example.com');
    expect(body.auth.port).toBe(443);
    expect(typeof body.auth.sslExpiry).toBe('string');
    expect(body.errors.last5m).toBeTruthy();
  });

  it('computes error-rate ratios', async () => {
    prismaMock.activityLog.count.mockImplementation(async (args: { where?: { OR?: unknown } }) =>
      args?.where?.OR ? 2 : 10,
    );
    const res = await GET(req());
    const body = await res.json();
    expect(body.errors.last5m.ratePct).toBeCloseTo(20);
  });
});
