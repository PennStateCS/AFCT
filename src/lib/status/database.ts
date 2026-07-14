import { prisma } from '@/lib/prisma';
import type { DatabaseDetails, DatabaseStats, DatabaseStatusResponse } from '@/lib/status/types';

function getNum(obj: Record<string, unknown>, k: string): number | undefined {
  const v = obj?.[k];
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function detectProvider(url: string): 'sqlite' | 'postgres' | 'unknown' {
  try {
    if (!url) return 'unknown';
    if (url.startsWith('file:') || url.includes('sqlite')) return 'sqlite';
    const u = new URL(url);
    if (u.protocol.startsWith('postgres')) return 'postgres';
  } catch {}
  return 'unknown';
}

/**
 * Database reachability, engine details, and per-engine stats (Postgres or
 * SQLite), plus the last applied migration. Every sub-probe is best-effort: a
 * failure is simply omitted, and total DB unreachability yields
 * `{ ok: false, message }`.
 */
export async function collectDatabase(): Promise<DatabaseStatusResponse> {
  const dbDetails: DatabaseDetails = {};
  const dbStats: DatabaseStats = {};
  const dbUrl = process.env.DATABASE_URL ?? '';
  const provider = detectProvider(dbUrl);
  let latencyMs: number | null = null;

  try {
    const start = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    latencyMs = Math.round(performance.now() - start);

    // ---------- PostgreSQL ----------
    if (provider === 'postgres' || provider === 'unknown') {
      try {
        const ver = (await prisma.$queryRaw`SELECT version() as v LIMIT 1`) as Array<{
          v?: string;
        }>;
        if (ver?.[0]?.v) dbDetails.version = String(ver[0].v);
      } catch {}
      try {
        const cur = (await prisma.$queryRaw`SELECT current_database() as name`) as Array<{
          name?: string;
        }>;
        if (cur?.[0]?.name) dbDetails.current_database = String(cur[0].name);
      } catch {}
      try {
        const now = (await prisma.$queryRaw`SELECT NOW() as now`) as Array<{ now?: Date }>;
        if (now?.[0]?.now) dbDetails.current_time_iso = new Date(now[0].now).toISOString();
      } catch {}

      try {
        const sp = (await prisma.$queryRawUnsafe(`SHOW search_path`)) as Array<
          Record<string, unknown>
        >;
        const val = sp?.[0] ? Object.values(sp[0])[0] : undefined;
        if (typeof val === 'string') dbDetails.search_path = val;
      } catch {}
      let visibleSchemas: string[] = [];
      try {
        const rs = (await prisma.$queryRaw`SELECT unnest(current_schemas(true)) AS nsp`) as Array<{
          nsp?: string;
        }>;
        visibleSchemas = rs.map((r) => r.nsp).filter((s): s is string => !!s);
      } catch {}
      const SYSTEM_SCHEMAS = new Set(['pg_catalog', 'information_schema', 'pg_toast']);
      const userVisible = visibleSchemas.filter((s) => !SYSTEM_SCHEMAS.has(s));
      if (userVisible.length) dbDetails.visible_schemas = userVisible;

      async function countTablesInSchemas(schemas: string[]): Promise<number | null> {
        if (!schemas.length) return null;
        const res = (await prisma.$queryRaw`
          SELECT count(*)::int AS cnt
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','f') AND n.nspname = ANY(${schemas})
        `) as Array<{ cnt?: number }>;
        return getNum(res?.[0] ?? {}, 'cnt') ?? 0;
      }

      let tableCountVisible: number | null = null;
      try {
        if (userVisible.length) tableCountVisible = await countTablesInSchemas(userVisible);
      } catch {}

      let tableCountAll: number | null = null;
      try {
        const res = (await prisma.$queryRaw`
          SELECT count(*)::int AS cnt
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','f')
            AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
        `) as Array<{ cnt?: number }>;
        tableCountAll = getNum(res?.[0] ?? {}, 'cnt') ?? 0;
      } catch {}

      dbDetails.table_count_visible = tableCountVisible;
      dbDetails.table_count_all = tableCountAll;
      dbDetails.table_count =
        typeof tableCountVisible === 'number' && tableCountVisible > 0
          ? tableCountVisible
          : typeof tableCountAll === 'number' && tableCountAll > 0
            ? tableCountAll
            : 0;

      dbStats.pg = {};
      // Local non-optional handle: control-flow narrowing of `dbStats.pg` doesn't
      // cross the async closures below, so capture the object once here.
      const pg = dbStats.pg;
      // These stat probes are independent and each write different keys, so run
      // them concurrently instead of serially (this tab was ~8 back-to-back
      // round-trips). Each keeps its own try/catch so one failure stays isolated.
      await Promise.all([
        (async () => {
          try {
            const mc = (await prisma.$queryRaw`
              SELECT setting::int as max_connections FROM pg_settings WHERE name='max_connections'
            `) as Array<{ max_connections?: number }>;
            pg.max_connections = getNum(mc?.[0] ?? {}, 'max_connections') ?? null;
          } catch {}
        })(),
        (async () => {
          try {
            const nb = (await prisma.$queryRaw`
              SELECT numbackends::int as num_backends, pg_database_size(current_database())::bigint as dbsize
              FROM pg_stat_database WHERE datname = current_database()
            `) as Array<{ num_backends?: number; dbsize?: number }>;
            pg.num_backends = getNum(nb?.[0] ?? {}, 'num_backends') ?? null;
            const dbsize = getNum(nb?.[0] ?? {}, 'dbsize');
            dbDetails.pg_database_size_bytes = dbsize ?? null;
            pg.db_size_mb =
              typeof dbsize === 'number' ? Math.round(dbsize / 1024 / 1024) : null;
          } catch {}
        })(),
        (async () => {
          try {
            const hit = (await prisma.$queryRaw`
              SELECT CASE WHEN (blks_hit + blks_read) = 0 THEN 0
                          ELSE (blks_hit::float / (blks_hit + blks_read)) * 100 END AS ratio
              FROM pg_stat_database WHERE datname = current_database()
            `) as Array<{ ratio?: number }>;
            const ratio = hit?.[0]?.ratio;
            pg.cache_hit_ratio =
              typeof ratio === 'number' && Number.isFinite(ratio) ? Number(ratio.toFixed(1)) : null;
          } catch {}
        })(),
        (async () => {
          try {
            const scans = (await prisma.$queryRaw`
              SELECT COALESCE(SUM(seq_scan),0)::bigint AS seq_scans,
                     COALESCE(SUM(idx_scan),0)::bigint AS idx_scans
              FROM pg_stat_user_tables
            `) as Array<{ seq_scans?: number; idx_scans?: number }>;
            pg.seq_scans = getNum(scans?.[0] ?? {}, 'seq_scans') ?? null;
            pg.idx_scans = getNum(scans?.[0] ?? {}, 'idx_scans') ?? null;
          } catch {}
        })(),
        (async () => {
          try {
            const tps = (await prisma.$queryRaw`
              SELECT CASE WHEN EXTRACT(EPOCH FROM (now() - stats_reset)) <= 0 THEN NULL
                          ELSE ROUND(((xact_commit + xact_rollback) / EXTRACT(EPOCH FROM (now() - stats_reset)))::numeric, 2)
                     END AS tps
              FROM pg_stat_database WHERE datname = current_database()
            `) as Array<{ tps?: number | null }>;
            const val = tps?.[0]?.tps;
            pg.transactions_per_sec =
              typeof val === 'number' && Number.isFinite(val) ? val : null;
          } catch {}
        })(),
        (async () => {
          try {
            const slow = (await prisma.$queryRaw`
              SELECT count(*)::int AS cnt FROM pg_stat_activity
              WHERE state = 'active' AND now() - query_start > interval '5 seconds'
            `) as Array<{ cnt?: number }>;
            pg.slow_query_count = getNum(slow?.[0] ?? {}, 'cnt') ?? null;
          } catch {}
        })(),
        (async () => {
          try {
            const cs = (await prisma.$queryRaw`
              SELECT coalesce(state,'unknown') as state, count(*)::int AS cnt
              FROM pg_stat_activity GROUP BY state
            `) as Array<{ state?: string; cnt?: number }>;
            pg.connections_by_state = Object.fromEntries(
              cs.map((r) => [r.state ?? 'unknown', r.cnt ?? 0]),
            );
          } catch {}
        })(),
        (async () => {
          try {
            const idleX = (await prisma.$queryRaw`
              SELECT count(*)::int AS cnt FROM pg_stat_activity WHERE state='idle in transaction'
            `) as Array<{ cnt?: number }>;
            pg.connections_idle_in_xact = getNum(idleX?.[0] ?? {}, 'cnt') ?? null;
          } catch {}
        })(),
      ]);
    }

    // ---------- SQLite ----------
    if (provider === 'sqlite' || provider === 'unknown') {
      try {
        const sq = (await prisma.$queryRawUnsafe(`SELECT sqlite_version() as v`)) as Array<{
          v?: string;
        }>;
        if (sq?.[0]?.v) dbDetails.sqlite_version = String(sq[0].v);
      } catch {}
      try {
        const now2 = (await prisma.$queryRawUnsafe(`SELECT datetime('now') as now`)) as Array<{
          now?: string;
        }>;
        if (now2?.[0]?.now) {
          const s = String(now2[0].now).replace(' ', 'T') + 'Z';
          dbDetails.current_time_iso = new Date(s).toISOString();
        }
      } catch {}

      dbDetails.table_names = [];
      try {
        const dblist = (await prisma.$queryRawUnsafe(`PRAGMA database_list`)) as Array<{
          name?: string;
        }>;
        const quoteIdent = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
        const names: string[] = [];
        const dbNames = dblist?.map((r) => r.name).filter((n): n is string => !!n) ?? ['main'];
        for (const db of dbNames) {
          const rows = (await prisma.$queryRawUnsafe(
            `SELECT name FROM ${quoteIdent(db)}.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
          )) as Array<{ name?: string }>;
          for (const r of rows) if (r?.name) names.push(r.name);
        }
        dbDetails.table_names = Array.from(new Set(names));
        dbDetails.table_count = dbDetails.table_names.length;
      } catch {
        try {
          const t1 = (await prisma.$queryRawUnsafe(
            `SELECT count(*) as count FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
          )) as Array<{ count?: number }>;
          dbDetails.table_count = getNum(t1?.[0] ?? {}, 'count') ?? 0;
        } catch {}
      }

      dbStats.sqlite = {};
      try {
        const jm = (await prisma.$queryRawUnsafe(`PRAGMA journal_mode`)) as Array<
          Record<string, unknown>
        >;
        const val = Object.values(jm?.[0] ?? {}).find((v) => typeof v === 'string') as
          | string
          | undefined;
        dbStats.sqlite.journal_mode = val ?? null;
      } catch {}
      try {
        const wc = (await prisma.$queryRawUnsafe(`PRAGMA wal_checkpoint(FULL)`)) as Array<
          Record<string, unknown>
        >;
        const row = wc?.[0];
        dbStats.sqlite.wal_checkpoint = row
          ? {
              busy: getNum(row, 'busy') ?? null,
              log: getNum(row, 'log') ?? null,
              checkpointed: getNum(row, 'checkpointed') ?? null,
            }
          : null;
      } catch {}
      try {
        const pc = (await prisma.$queryRawUnsafe(`PRAGMA page_count`)) as Array<{
          page_count?: number;
        }>;
        const ps = (await prisma.$queryRawUnsafe(`PRAGMA page_size`)) as Array<{
          page_size?: number;
        }>;
        const pageCount = getNum(pc?.[0] ?? {}, 'page_count') ?? 0;
        const pageSize = getNum(ps?.[0] ?? {}, 'page_size') ?? 0;
        if (pageCount && pageSize) {
          dbDetails.sqlite_page_count = pageCount;
          dbDetails.sqlite_page_size = pageSize;
          dbDetails.sqlite_approx_file_bytes = pageCount * pageSize;
        }
      } catch {}
      try {
        let p = dbUrl;
        if (p && (p.startsWith('file:') || p.includes('sqlite'))) {
          p = (p.startsWith('file:') ? p.replace('file:', '') : p).split('?')[0] ?? '';
          const pathMod = await import('path');
          const fsMod = await import('fs');
          const resolved = pathMod.isAbsolute(p) ? p : pathMod.resolve(process.cwd(), p);
          try {
            const st = await fsMod.promises.stat(resolved);
            dbDetails.sqlite_file_path = resolved;
            dbDetails.sqlite_file_bytes = Number(st.size);
          } catch {}
        }
      } catch {}
    }

    // ---------- Prisma migrate info ----------
    try {
      const m = (await prisma.$queryRawUnsafe(
        `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1`,
      )) as Array<{ migration_name?: string; finished_at?: Date | string | null }>;
      const row = m?.[0];
      if (row) {
        dbDetails.last_migration_name = row.migration_name ?? null;
        const fa = row.finished_at ? new Date(row.finished_at) : null;
        dbDetails.last_migration_finished_at = fa ? fa.toISOString() : null;
      }
    } catch {}

    return {
      ok: true,
      message: 'reachable',
      provider,
      latencyMs,
      details: dbDetails,
      stats: dbStats,
    };
  } catch (err) {
    const message = !err
      ? 'unknown'
      : typeof err === 'string'
        ? err
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message ?? 'unknown')
          : String(err);
    return { ok: false, message, provider, latencyMs };
  }
}
