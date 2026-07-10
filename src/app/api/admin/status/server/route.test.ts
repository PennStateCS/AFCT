import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({}));
const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('child_process', () => ({ execSync: execSyncMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSync = vi.fn().mockReturnValue(false);
  return { ...actual, existsSync, default: { ...actual, existsSync } };
});

import { GET } from './route';
import { clearStatusCache } from '@/lib/status/cache';
import { routeCtx } from '@/test/route';

beforeEach(() => {
  vi.clearAllMocks();
  clearStatusCache();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  execSyncMock.mockImplementation((cmd: string) => {
    if (cmd.includes('java -version')) return 'openjdk version "21.0.10" 2024-01-16';
    if (cmd.includes('afct-evaluator.jar')) return JSON.stringify({ version: '1.3.2' });
    return '';
  });
});

const req = () => new Request('http://localhost/api/admin/status/server');

describe('GET /api/admin/status/server', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req(), routeCtx())).status).toBe(401);
  });

  it('403 for a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    expect((await GET(req(), routeCtx())).status).toBe(403);
  });

  it('returns system metrics and software versions', async () => {
    const res = await GET(req(), routeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.system).toBeTruthy();
    expect(typeof body.system.uptime).toBe('number');
    expect(body.system.stats).toBeTruthy();
    expect(body.software.nodeVersion).toBe(process.version);
    expect(body.software.javaVersion).toBe('21.0.10');
    expect(body.software.evaluatorVersion).toBe('1.3.2');
  });

  it('caches the java/evaluator version probe across polls', async () => {
    await GET(req(), routeCtx());
    await GET(req(), routeCtx());
    const javaCalls = execSyncMock.mock.calls.filter((c) => String(c[0]).includes('java -version'));
    expect(javaCalls).toHaveLength(1); // second poll served from the TTL cache
  });

  it('tolerates a missing java toolchain', async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('java not found');
    });
    const res = await GET(req(), routeCtx());
    expect(res.status).toBe(200);
    expect((await res.json()).software.javaVersion).toBeUndefined();
  });
});
