import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  $queryRawUnsafe: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { collectDatabase, detectProvider } from '@/lib/status/database';

const envBackup = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...envBackup };
});

describe('detectProvider', () => {
  it('recognises sqlite by file: scheme and by name', () => {
    expect(detectProvider('file:./dev.db')).toBe('sqlite');
    expect(detectProvider('sqlite://whatever')).toBe('sqlite');
  });

  it('recognises postgres by protocol', () => {
    expect(detectProvider('postgresql://user:pw@host:5432/db')).toBe('postgres');
    expect(detectProvider('postgres://host/db')).toBe('postgres');
  });

  it('returns unknown for an empty, unrecognised, or malformed url', () => {
    expect(detectProvider('')).toBe('unknown');
    expect(detectProvider('mysql://host/db')).toBe('unknown');
    expect(detectProvider('::: not a url :::')).toBe('unknown');
  });
});

describe('collectDatabase', () => {
  it('returns ok:false with the error message when the DB is unreachable', async () => {
    process.env.DATABASE_URL = 'postgresql://host/db';
    prismaMock.$queryRaw.mockRejectedValue(new Error('Connection refused'));

    const res = await collectDatabase();

    expect(res.ok).toBe(false);
    expect(res.provider).toBe('postgres');
    expect(res.latencyMs).toBeNull();
    if (!res.ok) expect(res.message).toContain('Connection refused');
  });

  it('collects engine details and per-engine stats for a reachable Postgres', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pw@host:5432/afct';

    // Route each probe by the SQL it runs. $queryRaw is a tagged template (first arg
    // is the strings array); $queryRawUnsafe passes a plain string. Joining the parts
    // gives a stable, matchable skeleton without caring about interpolated values.
    const route = (raw: unknown): unknown[] => {
      const sql = (Array.isArray(raw) ? raw.join(' ') : String(raw)).toLowerCase();
      if (sql.includes('version()')) return [{ v: 'PostgreSQL 16.2 on x86_64' }];
      if (sql.includes('current_database() as name')) return [{ name: 'afct' }];
      if (sql.includes('now() as now')) return [{ now: new Date('2026-07-14T12:00:00Z') }];
      if (sql.includes('show search_path')) return [{ search_path: 'public' }];
      if (sql.includes('current_schemas')) return [{ nsp: 'public' }];
      if (sql.includes('pg_class')) return [{ cnt: 25 }];
      if (sql.includes('max_connections')) return [{ max_connections: 100 }];
      if (sql.includes('numbackends'))
        return [{ num_backends: 4, dbsize: 20 * 1024 * 1024 }];
      if (sql.includes('blks_hit')) return [{ ratio: 98.7 }];
      if (sql.includes('seq_scan')) return [{ seq_scans: 10, idx_scans: 90 }];
      if (sql.includes('xact_commit')) return [{ tps: 3.5 }];
      if (sql.includes('idle in transaction')) return [{ cnt: 1 }];
      if (sql.includes('group by state'))
        return [
          { state: 'active', cnt: 2 },
          { state: 'idle', cnt: 3 },
        ];
      if (sql.includes('query_start')) return [{ cnt: 0 }]; // slow-query probe
      if (sql.includes('_prisma_migrations'))
        return [{ migration_name: '20260101_init', finished_at: new Date('2026-01-01T00:00:00Z') }];
      return [{}]; // SELECT 1 and anything unmatched
    };

    prismaMock.$queryRaw.mockImplementation(async (strings: unknown) => route(strings));
    prismaMock.$queryRawUnsafe.mockImplementation(async (query: unknown) => route(query));

    const res = await collectDatabase();

    expect(res.ok).toBe(true);
    expect(res.provider).toBe('postgres');
    expect(typeof res.latencyMs).toBe('number');
    if (!res.ok) throw new Error('expected reachable');

    const d = res.details ?? {};
    expect(d.version).toContain('PostgreSQL');
    expect(d.current_database).toBe('afct');
    expect(d.search_path).toBe('public');
    expect(d.visible_schemas).toEqual(['public']);
    expect(d.table_count).toBe(25);
    expect(d.last_migration_name).toBe('20260101_init');

    const pg = res.stats?.pg ?? {};
    expect(pg.max_connections).toBe(100);
    expect(pg.num_backends).toBe(4);
    expect(pg.db_size_mb).toBe(20);
    expect(pg.cache_hit_ratio).toBe(98.7);
    expect(pg.seq_scans).toBe(10);
    expect(pg.idx_scans).toBe(90);
    expect(pg.transactions_per_sec).toBe(3.5);
    expect(pg.connections_by_state).toEqual({ active: 2, idle: 3 });
    expect(pg.connections_idle_in_xact).toBe(1);
  });

  it('keeps each stat probe isolated: one failing query does not sink the rest', async () => {
    process.env.DATABASE_URL = 'postgresql://host/afct';
    prismaMock.$queryRaw.mockImplementation(async (strings: unknown) => {
      const sql = (Array.isArray(strings) ? strings.join(' ') : String(strings)).toLowerCase();
      if (sql.includes('max_connections')) throw new Error('permission denied');
      if (sql.includes('current_database() as name')) return [{ name: 'afct' }];
      return [{}];
    });
    prismaMock.$queryRawUnsafe.mockResolvedValue([]);

    const res = await collectDatabase();

    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected reachable');
    // The failed probe is simply omitted; a sibling probe still populated its field.
    expect(res.details?.current_database).toBe('afct');
    expect(res.stats?.pg?.max_connections ?? null).toBeNull();
  });
});
