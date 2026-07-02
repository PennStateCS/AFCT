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
const tlsConnectMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('dns', () => ({ promises: { lookup: vi.fn().mockResolvedValue([]) } }));
vi.mock('child_process', () => ({ execSync: execSyncMock }));
vi.mock('tls', () => ({ connect: tlsConnectMock }));
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
import fs from 'fs';

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

  tlsConnectMock.mockImplementation((_options: unknown, onSecure: () => void) => {
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

  it('stringifies non-Error database failures safely', async () => {
    prismaMock.$queryRaw.mockRejectedValue({ code: 'E_DB' });

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const database = body.database as { ok?: boolean; message?: string };
    expect(database?.ok).toBe(false);
    expect(database?.message).toBe('[object Object]');
  });

  it('uses string database errors as message directly', async () => {
    prismaMock.$queryRaw.mockRejectedValue('plain db failure');

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const database = body.database as { ok?: boolean; message?: string };
    expect(database?.ok).toBe(false);
    expect(database?.message).toBe('plain db failure');
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

  it('includes both NEXT_PUBLIC_ and PUBLIC_ variables in env.public', async () => {
    process.env.NEXT_PUBLIC_APP_NAME = 'afct';
    process.env.PUBLIC_DOCS_URL = 'https://docs.example.com';

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const env = body.env as { public?: Record<string, string> } | undefined;
    expect(env?.public?.NEXT_PUBLIC_APP_NAME).toBe('afct');
    expect(env?.public?.PUBLIC_DOCS_URL).toBe('https://docs.example.com');
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

  it('includes abandoned files summary and caps samples at 50', async () => {
    const readdirMock = vi.mocked(fs.promises.readdir);
    const files60 = Array.from({ length: 60 }, (_, i) => ({
      isFile: () => true,
      name: `f${i}.txt`,
    })) as Array<{ isFile: () => boolean; name: string }>;

    readdirMock.mockResolvedValue(files60 as any);
    prismaMock.problem.findMany.mockResolvedValue([]);
    prismaMock.submission.findMany.mockResolvedValue([]);
    prismaMock.user.findMany.mockResolvedValue([]);

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const abandoned = body.abandonedFiles as
      | {
          total: number;
          byCategory: Record<string, number>;
          samples: Array<{ category: string }>;
        }
      | undefined;

    expect(abandoned?.total).toBe(240);
    expect(abandoned?.byCategory.solutions).toBe(60);
    expect(abandoned?.byCategory.submissions).toBe(60);
    expect(abandoned?.byCategory.pfps).toBe(60);
    expect(abandoned?.byCategory.problems).toBe(60);
    expect(abandoned?.samples.length).toBe(50);
  });

  it('reports unknown provider for malformed DATABASE_URL', async () => {
    process.env.DATABASE_URL = 'not-a-valid-db-url';

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const metrics = body.metrics as { provider?: string } | undefined;
    expect(metrics?.provider).toBe('unknown');
  });

  it('reports unknown provider when DATABASE_URL is empty', async () => {
    process.env.DATABASE_URL = '';

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const metrics = body.metrics as { provider?: string } | undefined;
    expect(metrics?.provider).toBe('unknown');
  });

  it('omits network section when activity log aggregation fails', async () => {
    prismaMock.activityLog.count.mockRejectedValue(new Error('network aggregation failed'));

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.network).toBeUndefined();
  });

  it('omits software section when software env metadata is absent', async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.APP_ENV;
    delete process.env.ENVIRONMENT;
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.GIT_COMMIT;
    delete process.env.COMMIT_SHA;
    delete process.env.SOURCE_VERSION;
    delete process.env.GITHUB_SHA;
    delete process.env.RENDER_GIT_COMMIT;
    delete process.env.IMAGE_TAG;
    delete process.env.DOCKER_IMAGE_TAG;
    delete process.env.CONTAINER_IMAGE_TAG;
    delete process.env.IMAGE_VERSION;
    delete process.env.GIT_TAG;
    delete process.env.VERCEL_GIT_COMMIT_REF;

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.software).toBeUndefined();
  });

  it('falls back to sqlite table count when database list introspection fails', async () => {
    prismaMock.$queryRawUnsafe.mockImplementation(async (query: unknown) => {
      const sql = String(query ?? '');
      if (sql.includes('PRAGMA database_list')) throw new Error('database_list unavailable');
      if (sql.includes('count(*) as count FROM sqlite_schema')) return [{ count: 7 }];
      return [];
    });

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const database = body.database as
      | { details?: { table_count?: number; table_names?: string[] } }
      | undefined;
    expect(database?.details?.table_count).toBe(7);
    expect(database?.details?.table_names).toEqual([]);
  });

  it('caps active sessions at 200 records', async () => {
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

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const activeSessions = body.activeSessions as Array<Record<string, unknown>> | undefined;
    const sessionSummary = body.sessionSummary as
      | { total24h?: number; uniqUsers24h?: number; last5m?: number }
      | undefined;

    expect(activeSessions).toHaveLength(200);
    expect(sessionSummary?.total24h).toBe(205);
    expect(sessionSummary?.uniqUsers24h).toBe(200);
    expect(sessionSummary?.last5m).toBe(200);
  });

  it('handles auth URL parse failure and still returns network diagnostics', async () => {
    delete process.env.NEXTAUTH_URL;
    const OriginalURL = URL;

    class ThrowingAuthUrl extends OriginalURL {
      constructor(input: string | URL, base?: string | URL) {
        if (typeof input === 'string' && input === 'http://localhost' && base === undefined) {
          throw new TypeError('invalid auth URL');
        }
        super(input, base);
      }
    }

    globalThis.URL = ThrowingAuthUrl as unknown as typeof URL;
    try {
      const req = new Request('http://localhost/api/status');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const network = body.network as
        | { auth?: { host?: string | null; port?: number | null; resolved?: string[] | null } }
        | undefined;

      expect(network).toBeTruthy();
      expect(network?.auth?.host).toBeNull();
      expect(network?.auth?.port).toBeNull();
      expect(network?.auth?.resolved).toBeNull();
    } finally {
      globalThis.URL = OriginalURL;
    }
  });

  it('uses https default auth port and includes TLS expiry when available', async () => {
    process.env.NEXTAUTH_URL = 'https://auth.example.com';

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const network = body.network as
      | { auth?: { host?: string | null; port?: number | null; sslExpiry?: string | null } }
      | undefined;

    expect(network?.auth?.host).toBe('auth.example.com');
    expect(network?.auth?.port).toBe(443);
    expect(typeof network?.auth?.sslExpiry).toBe('string');
  });

  it('uses explicit https port from NEXTAUTH_URL when provided', async () => {
    process.env.NEXTAUTH_URL = 'https://auth.example.com:9443';

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const network = body.network as { auth?: { port?: number | null } } | undefined;
    expect(network?.auth?.port).toBe(9443);
  });

  it('uses default http auth port when NEXTAUTH_URL has no explicit port', async () => {
    process.env.NEXTAUTH_URL = 'http://auth.example.com';

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const network = body.network as { auth?: { port?: number | null } } | undefined;
    expect(network?.auth?.port).toBe(80);
  });

  it('enumerates sqlite tables across attached databases', async () => {
    prismaMock.$queryRawUnsafe.mockImplementation(async (query: unknown) => {
      const sql = String(query ?? '');
      if (sql.includes('PRAGMA database_list')) {
        return [{ seq: 0, name: 'main', file: '/data/app.db' }];
      }
      if (sql.includes('sqlite_schema') && sql.includes('SELECT name FROM')) {
        return [{ name: 'Users' }, { name: 'Courses' }, { name: null }];
      }
      return [];
    });

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const database = body.database as
      | { details?: { table_names?: string[]; table_count?: number } }
      | undefined;
    expect(database?.details?.table_names).toEqual(['Users', 'Courses']);
    expect(database?.details?.table_count).toBe(2);
  });

  it('classifies orphaned upload files by category', async () => {
    vi.mocked(fs.promises.readdir).mockImplementation(async (dir: unknown) => {
      const d = String(dir);
      const ent = (name: string) => ({ isFile: () => true, name });
      if (d.includes('solutions')) return [ent('sol1.jff'), ent('orphan-sol.jff')] as any;
      if (d.includes('submissions')) return [ent('sub1.txt'), ent('orphan-sub.txt')] as any;
      if (d.includes('pfps')) return [ent('avatar1.png'), ent('orphan-pfp.png')] as any;
      if (d.includes('problems')) return [ent('prob1.jff')] as any;
      return [] as any;
    });
    // Some rows carry null filenames to exercise the non-null filter predicate.
    prismaMock.problem.findMany.mockResolvedValue([
      { fileName: 'sol1.jff' },
      { fileName: 'prob1.jff' },
      { fileName: null },
    ]);
    prismaMock.submission.findMany.mockResolvedValue([{ fileName: 'sub1.txt' }, { fileName: null }]);
    prismaMock.user.findMany.mockResolvedValue([{ avatar: 'avatar1.png' }, { avatar: null }]);

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const abandoned = body.abandonedFiles as
      | { total: number; byCategory: Record<string, number> }
      | undefined;
    expect(abandoned?.byCategory).toEqual({
      solutions: 1,
      submissions: 1,
      pfps: 1,
      problems: 0,
    });
    expect(abandoned?.total).toBe(3);
  });

  it('tolerates upload directories that cannot be read', async () => {
    vi.mocked(fs.promises.readdir).mockRejectedValue(new Error('EACCES'));

    const req = new Request('http://localhost/api/status');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const abandoned = body.abandonedFiles as { total: number } | undefined;
    expect(abandoned?.total).toBe(0);
  });

  it('includes top queries for a deep postgres probe', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
    prismaMock.$queryRaw.mockResolvedValue([
      { pid: 42, state: 'active', age_ms: 1234.6, query_trunc: 'SELECT 1' },
    ]);

    const req = new Request('http://localhost/api/status?deep=1');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const database = body.database as
      | { stats?: { pg?: { top_queries?: Array<{ pid: number; age_ms: number }> } } }
      | undefined;
    expect(database?.stats?.pg?.top_queries?.[0]).toMatchObject({ pid: 42, age_ms: 1235 });
  });
});
