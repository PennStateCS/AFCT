import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
  activityLog: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  user: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  course: {
    count: vi.fn(),
  },
  assignment: {
    count: vi.fn(),
  },
  problem: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  submission: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
}));

const execSyncMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('dns', () => ({ promises: { lookup: vi.fn().mockResolvedValue([]) } }));
vi.mock('child_process', () => ({ execSync: execSyncMock }));
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const readdir = vi.fn().mockResolvedValue([]);
  const existsSync = vi.fn().mockReturnValue(false);
  const readFile = vi.fn().mockImplementation(async (filePath: string) => {
    if (filePath === '/proc/1/cgroup') {
      return '0::/docker/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    }
    if (filePath === '/proc/mounts') {
      return '/dev/sda1 / ext4 rw,relatime 0 0';
    }
    if (filePath === '/proc/diskstats') {
      return '   8       0 sda 1 0 100 0 1 0 200 0 0 0 0 0 0';
    }
    return '';
  });
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readdir,
      readFile,
    },
    existsSync,
    default: {
      ...actual,
      promises: {
        ...actual.promises,
        readdir,
        readFile,
      },
      existsSync,
    },
  };
});

import { GET } from './route';

const envBackup = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'sqlite://memory';
  process.env.NEXTAUTH_URL = 'http://localhost:3000';

  prismaMock.$queryRaw.mockResolvedValue([]);
  prismaMock.$queryRawUnsafe.mockResolvedValue([]);
  prismaMock.activityLog.findMany.mockResolvedValue([]);
  prismaMock.activityLog.count.mockResolvedValue(0);
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.course.count.mockResolvedValue(0);
  prismaMock.assignment.count.mockResolvedValue(0);
  prismaMock.problem.count.mockResolvedValue(0);
  prismaMock.submission.count.mockResolvedValue(0);
  prismaMock.problem.findMany.mockResolvedValue([]);
  prismaMock.submission.findMany.mockResolvedValue([]);
  prismaMock.user.findMany.mockResolvedValue([]);

  execSyncMock.mockImplementation((cmd: string) => {
    if (cmd.includes('java -version')) {
      return 'openjdk version "21.0.10" 2024-01-16';
    }
    if (cmd.includes('afct-evaluator.jar')) {
      return JSON.stringify({ version: '1.3.2' });
    }
    return '';
  });

  (globalThis as { fetch?: typeof fetch }).fetch = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 200 }));
});

afterEach(() => {
  process.env = { ...envBackup };
  vi.restoreAllMocks();
});

describe('GET /api/status', () => {
  it('returns status payload', async () => {
    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.system).toBeTruthy();
    expect(body.database).toBeTruthy();
    expect(body.metrics).toBeTruthy();
    expect(body.env).toBeTruthy();
    expect(body.app).toBeTruthy();
  });

  it('includes docker and software metadata when available', async () => {
    process.env.DOCKER_CONTAINER = '1';
    process.env.APP_ENV = 'production';
    process.env.GIT_COMMIT = 'abcdef0123456789abcdef0123456789abcdef01';
    process.env.IMAGE_TAG = 'v1.2.3';

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const docker = body.docker as { isDocker?: boolean; containerIdShort?: string } | undefined;
    const software = body.software as
      | { deployEnv?: string; buildHash?: string; imageTag?: string }
      | undefined;

    expect(docker?.isDocker).toBe(true);
    expect(software?.deployEnv).toBe('production');
    expect(software?.buildHash).toBe('abcdef0123456789abcdef0123456789abcdef01');
    expect(software?.imageTag).toBe('v1.2.3');
  });

  it('supports deep query parameter for extended diagnostics', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ version: '14.1' }]);

    const req = new Request('http://localhost/api/status?deep=1');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toBeTruthy();
  });

  it('handles Postgres database provider', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    prismaMock.$queryRaw.mockResolvedValue([{ version: '14.1' }]);
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const database = body.database as { ok?: boolean; details?: Record<string, unknown> };
    expect(database?.ok).toBe(true);
  });

  it('collects counts from database', async () => {
    prismaMock.user.count.mockResolvedValue(25);
    prismaMock.course.count.mockResolvedValue(5);
    prismaMock.assignment.count.mockResolvedValue(15);
    prismaMock.problem.count.mockResolvedValue(50);
    prismaMock.submission.count.mockResolvedValue(200);
    prismaMock.activityLog.count.mockResolvedValue(1000);

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const app = body.app as Record<string, unknown>;
    expect(app.users).toBe(25);
    expect(app.courses).toBe(5);
    expect(app.assignments).toBe(15);
    expect(app.problems).toBe(50);
    expect(app.submissions).toBe(200);
  });

  it('handles database connection errors gracefully', async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error('Connection failed'));

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const database = body.database as { ok?: boolean; message?: string };
    expect(database?.ok).toBe(false);
    expect(database?.message).toContain('failed');
  });

  it('includes environment variables in env section', async () => {
    process.env.NEXTAUTH_URL = 'https://example.com';
    process.env.NODE_ENV = 'production';

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const env = body.env as Record<string, unknown>;
    expect(env.public).toBeTruthy();
    expect(env.masked).toBeTruthy();
  });

  it('handles activity log queries', async () => {
    prismaMock.activityLog.findMany.mockResolvedValue([]);
    prismaMock.activityLog.count.mockResolvedValue(100);

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toBeTruthy();
  });

  it('includes Java version when available', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if ((cmd as string).includes('java -version')) {
        return 'openjdk version "21.0.10" 2024-01-16';
      }
      return '';
    });

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const app = body.app as { javaVersion?: string };
    expect(app?.javaVersion).toBeTruthy();
  });

  it('handles missing Java gracefully', async () => {
    execSyncMock.mockImplementation(() => {
      throw new Error('java not found');
    });

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toBeTruthy();
  });
});
