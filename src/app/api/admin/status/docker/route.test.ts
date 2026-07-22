import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const activityLogMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({}));

vi.mock('@/lib/auth', () => ({ auth: authMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/activity-log-utils', () => ({ createEnhancedActivityLog: activityLogMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const existsSync = vi.fn().mockReturnValue(false);
  const readFile = vi.fn().mockResolvedValue('');
  return {
    ...actual,
    existsSync,
    promises: { ...actual.promises, readFile },
    default: { ...actual, existsSync, promises: { ...actual.promises, readFile } },
  };
});

import { GET } from './route';
import fs from 'fs';
import { routeCtx } from '@/test/route';

const envBackup = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: 'admin-1', isAdmin: true } });
  process.env = { ...envBackup };
  delete process.env.DOCKER_CONTAINER;
  delete process.env.CONTAINER;
});

const req = () => new Request('http://localhost/api/admin/status/docker');

describe('GET /api/admin/status/docker', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req(), routeCtx())).status).toBe(401);
  });

  it('403 for a non-admin', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1', isAdmin: false } });
    expect((await GET(req(), routeCtx())).status).toBe(403);
  });

  it('reports docker: null when not containerized', async () => {
    const res = await GET(req(), routeCtx());
    expect(res.status).toBe(200);
    expect((await res.json()).docker).toBeNull();
  });

  it('detects a container from cgroup + env indicators', async () => {
    process.env.DOCKER_CONTAINER = '1';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.readFile).mockResolvedValue(
      '0::/docker/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    );

    const res = await GET(req(), routeCtx());
    const body = await res.json();
    expect(body.docker.isDocker).toBe(true);
    expect(body.docker.containerIdShort).toBe('abcdef012345');
    expect(body.docker.indicators).toContain('CONTAINER env');
    expect(body.docker.cgroupVersion).toBe('v2');
    expect(body.docker.imageTag).toBeTruthy();
  });

  it('derives the id from the hostname and parses cgroup-v2 limits', async () => {
    process.env.DOCKER_CONTAINER = '1';
    process.env.AFCT_APP_TAG = 'v9.9.9';
    process.env.HOSTNAME = 'd8745c2b78ed';
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === '/.dockerenv' || p === '/sys/fs/cgroup/cgroup.controllers',
    );
    vi.mocked(fs.promises.readFile).mockImplementation(async (p) => {
      const path = String(p);
      if (path === '/proc/1/cgroup') return '0::/'; // cgroup v2: no 64-hex id here
      if (path === '/sys/fs/cgroup/memory.max') return '4294967296\n'; // 4 GiB
      if (path === '/sys/fs/cgroup/cpu.max') return '200000 100000\n'; // 2 cores
      return '';
    });

    const res = await GET(req(), routeCtx());
    const body = await res.json();
    // No id in cgroup v2, so it falls back to the hostname (the short container id).
    expect(body.docker.containerIdShort).toBe('d8745c2b78ed');
    expect(body.docker.cgroupVersion).toBe('v2');
    expect(body.docker.memoryLimitBytes).toBe(4294967296);
    expect(body.docker.cpuLimit).toBe(2);
    expect(body.docker.imageTag).toBe('v9.9.9');
  });

  it('reports no-limit (null) when cgroup v2 caps are "max"', async () => {
    process.env.DOCKER_CONTAINER = '1';
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === '/sys/fs/cgroup/cgroup.controllers',
    );
    vi.mocked(fs.promises.readFile).mockImplementation(async (p) => {
      const path = String(p);
      if (path === '/sys/fs/cgroup/memory.max') return 'max\n';
      if (path === '/sys/fs/cgroup/cpu.max') return 'max 100000\n';
      return '';
    });

    const res = await GET(req(), routeCtx());
    const body = await res.json();
    expect(body.docker.memoryLimitBytes).toBeNull();
    expect(body.docker.cpuLimit).toBeNull();
  });
});
