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
  });
});
