import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DatabaseDetails = {
  version?: string;
  sqlite_version?: string;
  current_database?: string;
  current_time_iso?: string;

  // Diagnostic helpers (Postgres)
  search_path?: string;
  visible_schemas?: string[];

  // Prefer visible -> all; keep legacy table_count for backward compatibility
  table_count?: number;
  table_count_visible?: number | null;
  table_count_all?: number | null;

  // NEW (SQLite): optional list of table names across attached DBs
  table_names?: string[];

  sqlite_page_count?: number;
  sqlite_page_size?: number;
  sqlite_approx_file_bytes?: number;
  sqlite_file_path?: string;
  sqlite_file_bytes?: number;

  pg_active_connections?: number | null;
  pg_database_size_bytes?: number | null;

  last_migration_name?: string | null;
  last_migration_finished_at?: string | null;
};

type DatabaseStats = {
  pg?: {
    max_connections?: number | null;
    num_backends?: number | null;
    connections_by_state?: Record<string, number>;
    connections_idle_in_xact?: number | null;
    db_size_mb?: number | null;
    top_queries?: Array<{ pid: number; state: string | null; age_ms: number; query_trunc: string }>;
  };
  sqlite?: {
    journal_mode?: string | null;
    wal_checkpoint?: {
      busy?: number | null;
      log?: number | null;
      checkpointed?: number | null;
    } | null;
  };
};

type DatabaseStatus = {
  ok: boolean;
  message: string;
  details?: DatabaseDetails;
  stats?: DatabaseStats;
};
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
function detectProvider(url: string): 'sqlite' | 'postgres' | 'unknown' {
  try {
    if (!url) return 'unknown';
    if (url.startsWith('file:') || url.includes('sqlite')) return 'sqlite';
    const u = new URL(url);
    if (u.protocol.startsWith('postgres')) return 'postgres';
  } catch {}
  return 'unknown';
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resolveHost(host?: string | null): Promise<string[] | null> {
  if (!host) return null;
  try {
    const dns = await import('dns');
    const results = await dns.promises.lookup(host, { all: true });
    return Array.from(new Set(results.map((r) => r.address)));
  } catch {
    return null;
  }
}

async function measureFetchLatency(url?: string | null, timeoutMs = 3000): Promise<number | null> {
  if (!url) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = performance.now();
    await fetch(url, { method: 'GET', cache: 'no-store', signal: controller.signal });
    const t1 = performance.now();
    clearTimeout(timer);
    return Math.round(t1 - t0);
  } catch {
    return null;
  }
}

async function getTlsExpiry(host?: string | null, port?: number | null): Promise<string | null> {
  if (!host) return null;
  try {
    const tls = await import('tls');
    const p = port ?? 443;
    const cert = await new Promise<tls.PeerCertificate>((resolve, reject) => {
      const socket = tls.connect(
        { host, port: p, servername: host, rejectUnauthorized: false, timeout: 3000 },
        () => {
          const c = socket.getPeerCertificate();
          socket.end();
          resolve(c);
        },
      );
      socket.on('error', (err) => reject(err));
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('timeout'));
      });
    });
    const validTo = (cert as { valid_to?: string }).valid_to;
    if (!validTo) return null;
    const dt = new Date(validTo);
    return Number.isFinite(dt.getTime()) ? dt.toISOString() : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const t0 = performance.now();
  const url = new URL(req.url);
  const deep = url.searchParams.get('deep') === '1';
  const origin = url.origin;
  const authBase = process.env.NEXTAUTH_URL ? new URL(process.env.NEXTAUTH_URL).origin : origin;
  const authProbeUrl = new URL('/api/auth/session', authBase).toString();

  // ===== System =====
  const os = await import('os');

  // quick per-process CPU usage sample (~100ms)
  const cores = os.cpus()?.length ?? 1;
  const cpu0 = process.cpuUsage();
  const time0 = process.hrtime.bigint();
  await sleep(100);
  const cpu1 = process.cpuUsage(cpu0);
  const time1 = process.hrtime.bigint();
  const elapsedMicros = Number((time1 - time0) / 1000n); // wall micros
  const procCpuMicros = cpu1.user + cpu1.system;
  const cpuPct =
    elapsedMicros > 0 ? Math.min(100, (procCpuMicros / elapsedMicros) * (100 / cores)) : 0;

  const system = {
    ok: true,
    uptime: os.uptime(),
    processUptime: process.uptime(),
    nodeVersion: process.version,
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    cpuCount: cores,
    cpus:
      os
        .cpus()
        ?.slice(0, 4)
        .map((c) => ({
          model: (c as { model?: string }).model,
          speed: (c as { speed?: number }).speed,
        })) ?? [],
    memory: { total: os.totalmem(), free: os.freemem() },
    loadavg: os.loadavg(),
    ipAddresses: (() => {
      try {
        const netifs = os.networkInterfaces();
        const out: Array<{ iface: string; address: string; family: string }> = [];
        const skipIfName = /^(docker|veth|br-|virbr|vmnet|vboxnet|lo|loopback)$/i;
        for (const [name, addrs] of Object.entries(netifs)) {
          if (!addrs || skipIfName.test(name)) continue;
          for (const a of addrs) {
            const addr = a as { address?: string; family?: string | number; internal?: boolean };
            if (!addr || addr.internal) continue;
            const address = addr.address ?? '';
            if (!address || address === '::1') continue;
            if (/^fe80:/i.test(address)) continue; // IPv6 link-local
            if (/^f[cd]/i.test(address)) continue; // IPv6 ULA
            if (/^169\.254\./.test(address)) continue; // IPv4 link-local
            out.push({ iface: name, address, family: String(addr.family ?? '') });
          }
        }
        const seen = new Set<string>();
        return out.filter((i) => (seen.has(i.address) ? false : (seen.add(i.address), true)));
      } catch {
        return [] as Array<{ iface: string; address: string; family: string }>;
      }
    })(),
    stats: {
      pid: process.pid,
      cwd: process.cwd(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      memProcess: { ...process.memoryUsage() },
      memProcessPctOfSystem: (() => {
        const mu = process.memoryUsage();
        const rss = mu.rss ?? 0;
        const total = os.totalmem() || 1;
        return Number(((rss / total) * 100).toFixed(2));
      })(),
      cpuProcessPct: Number(cpuPct.toFixed(2)),
      uptimeBreakdown: (() => {
        const secs = Math.floor(process.uptime());
        const d = Math.floor(secs / 86400);
        const h = Math.floor((secs % 86400) / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        return { days: d, hours: h, minutes: m, seconds: s };
      })(),
    },
  };

  // ===== Database =====
  const dbDetails: DatabaseDetails = {};
  const dbStats: DatabaseStats = {};
  const dbUrl = process.env.DATABASE_URL ?? '';
  const provider = detectProvider(dbUrl);
  let database: DatabaseStatus = { ok: false, message: 'unknown' };
  let dbLatencyMs: number | null = null;

  try {
    const dbLatencyStart = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Math.round(performance.now() - dbLatencyStart);
    database = { ok: true, message: 'reachable' };

    // ---------- PostgreSQL ----------
    if (provider === 'postgres' || provider === 'unknown') {
      try {
        const ver = (await prisma.$queryRaw`SELECT version() as v LIMIT 1`) as Array<{
          v?: string;
        }>;
        const v = ver?.[0]?.v;
        if (v) dbDetails.version = String(v);
      } catch {}
      try {
        const cur = (await prisma.$queryRaw`SELECT current_database() as name`) as Array<{
          name?: string;
        }>;
        const name = cur?.[0]?.name;
        if (name) dbDetails.current_database = String(name);
      } catch {}
      try {
        const now = (await prisma.$queryRaw`SELECT NOW() as now`) as Array<{ now?: Date }>;
        const dt = now?.[0]?.now;
        if (dt) dbDetails.current_time_iso = new Date(dt).toISOString();
      } catch {}

      // Robust table counting
      try {
        const sp = (await prisma.$queryRawUnsafe(`SHOW search_path`)) as Array<
          Record<string, unknown>
        >;
        const val = sp?.[0] ? Object.values(sp[0])[0] : undefined;
        if (typeof val === 'string') dbDetails.search_path = val;
      } catch {}
      let visibleSchemas: string[] = [];
      try {
        const rs = (await prisma.$queryRaw`
          SELECT unnest(current_schemas(true)) AS nsp
        `) as Array<{ nsp?: string }>;
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
          WHERE c.relkind IN ('r','p','f')
            AND n.nspname = ANY(${schemas})
        `) as Array<{ cnt?: number }>;
        return getNum(res?.[0] ?? {}, 'cnt') ?? 0;
      }

      let tableCountVisible: number | null = null;
      try {
        if (userVisible.length) {
          tableCountVisible = await countTablesInSchemas(userVisible);
        }
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
      try {
        const mc = (await prisma.$queryRaw`
          SELECT setting::int as max_connections FROM pg_settings WHERE name='max_connections'
        `) as Array<{ max_connections?: number }>;
        dbStats.pg.max_connections = getNum(mc?.[0] ?? {}, 'max_connections') ?? null;
      } catch {}
      try {
        const nb = (await prisma.$queryRaw`
          SELECT numbackends::int as num_backends, pg_database_size(current_database())::bigint as dbsize
          FROM pg_stat_database WHERE datname = current_database()
        `) as Array<{ num_backends?: number; dbsize?: number }>;
        dbStats.pg.num_backends = getNum(nb?.[0] ?? {}, 'num_backends') ?? null;
        const dbsize = getNum(nb?.[0] ?? {}, 'dbsize');
        dbDetails.pg_database_size_bytes = dbsize ?? null;
        dbStats.pg.db_size_mb =
          typeof dbsize === 'number' ? Math.round(dbsize / 1024 / 1024) : null;
      } catch {}
      try {
        const cs = (await prisma.$queryRaw`
          SELECT coalesce(state,'unknown') as state, count(*)::int AS cnt
          FROM pg_stat_activity
          GROUP BY state
        `) as Array<{ state?: string; cnt?: number }>;
        dbStats.pg.connections_by_state = Object.fromEntries(
          cs.map((r) => [r.state ?? 'unknown', r.cnt ?? 0]),
        );
      } catch {}
      try {
        const idleX = (await prisma.$queryRaw`
          SELECT count(*)::int AS cnt FROM pg_stat_activity WHERE state='idle in transaction'
        `) as Array<{ cnt?: number }>;
        dbStats.pg.connections_idle_in_xact = getNum(idleX?.[0] ?? {}, 'cnt') ?? null;
      } catch {}

      if (deep) {
        try {
          const top = (await prisma.$queryRaw`
            SELECT pid,
                   state,
                   EXTRACT(EPOCH FROM (now() - query_start)) * 1000 AS age_ms,
                   left(query, 200) AS query_trunc
            FROM pg_stat_activity
            WHERE state IN ('active','idle in transaction')
              AND query NOT ILIKE '%pg_stat_activity%'
            ORDER BY age_ms DESC
            LIMIT 5
          `) as Array<{ pid?: number; state?: string; age_ms?: number; query_trunc?: string }>;
          dbStats.pg.top_queries = top.map((r) => ({
            pid: r.pid ?? 0,
            state: r.state ?? null,
            age_ms: Math.round(r.age_ms ?? 0),
            query_trunc: r.query_trunc ?? '',
          }));
        } catch {}
      }
    }

    // ---------- SQLite ----------
    if (provider === 'sqlite' || provider === 'unknown') {
      try {
        const sq = (await prisma.$queryRawUnsafe(`SELECT sqlite_version() as v`)) as Array<{
          v?: string;
        }>;
        const v = sq?.[0]?.v;
        if (v) dbDetails.sqlite_version = String(v);
      } catch {}
      try {
        const now2 = (await prisma.$queryRawUnsafe(`SELECT datetime('now') as now`)) as Array<{
          now?: string;
        }>;
        const n = now2?.[0]?.now;
        if (n) {
          const s = String(n).replace(' ', 'T') + 'Z';
          dbDetails.current_time_iso = new Date(s).toISOString();
        }
      } catch {}

      // --- Robust SQLite table enumeration (handles ATTACHed DBs) ---
      dbDetails.table_names = [];
      try {
        // List attached databases (seq, name, file)
        const dblist = (await prisma.$queryRawUnsafe(`PRAGMA database_list`)) as Array<{
          seq?: number;
          name?: string;
          file?: string;
        }>;

        const quoteIdent = (s: string) => `"${String(s).replace(/"/g, '""')}"`;

        // We’ll iterate each db and collect table names (skip internal)
        const names: string[] = [];
        const dbNames = dblist?.map((r) => r.name).filter((n): n is string => !!n) ??
          // typically: main, temp, plus any attached; keep all
          ['main'];

        for (const db of dbNames) {
          const ident = quoteIdent(db);
          const rows = (await prisma.$queryRawUnsafe<{ name?: string }[]>(
            `SELECT name FROM ${ident}.sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
          )) as Array<{ name?: string }>;
          for (const r of rows) {
            if (r?.name) names.push(r.name);
          }
        }

        // Deduplicate across DBs
        dbDetails.table_names = Array.from(new Set(names));
        dbDetails.table_count = dbDetails.table_names.length;
      } catch {
        // Fallback to single-DB count if something fails
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
        const first = jm?.[0] ?? {};
        const val = Object.values(first).find((v) => typeof v === 'string') as string | undefined;
        dbStats.sqlite.journal_mode = val ?? null;
      } catch {}
      try {
        const wc = (await prisma.$queryRawUnsafe(`PRAGMA wal_checkpoint(FULL)`)) as Array<{
          busy?: number;
          log?: number;
          checkpointed?: number;
        }>;
        const row = wc?.[0];
        dbStats.sqlite.wal_checkpoint = row
          ? {
              busy: getNum(row as Record<string, unknown>, 'busy') ?? null,
              log: getNum(row as Record<string, unknown>, 'log') ?? null,
              checkpointed: getNum(row as Record<string, unknown>, 'checkpointed') ?? null,
            }
          : null;
      } catch {}

      // file metrics
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
          p = p.startsWith('file:') ? p.replace('file:', '') : p;
          p = p.split('?')[0];
          const path = await import('path');
          const fs = await import('fs');
          const resolved = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
          try {
            const st = await fs.promises.stat(resolved);
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
        const fa = row.finished_at ? new Date(row.finished_at as Date | string) : null;
        dbDetails.last_migration_finished_at = fa ? fa.toISOString() : null;
      }
    } catch {}

    database = { ...database, details: dbDetails, stats: dbStats };
  } catch (err) {
    const msg = !err
      ? 'unknown'
      : typeof err === 'string'
        ? err
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message ?? 'unknown')
          : String(err);
    database = { ok: false, message: msg };
  }

  // ===== Environment =====
  const envPublic: Record<string, string> = {};
  const envMaskedSummary: Record<string, string> = {};
  try {
    for (const [k, v] of Object.entries(process.env)) {
      if (k.startsWith('NEXT_PUBLIC_') || k.startsWith('PUBLIC_')) {
        envPublic[k] = String(v ?? '');
      } else {
        envMaskedSummary[k] = v == null ? '<unset>' : `<masked length=${String(v).length}>`;
      }
    }
  } catch {}

  // ===== Active sessions (ActivityLog heuristic) =====
  let activeSessions:
    | Array<{
        userId?: string | null;
        email?: string | null;
        ipAddress?: string | null;
        userAgent?: string | null;
        lastSeen?: string | null;
      }>
    | undefined = undefined;
  let sessionSummary:
    | {
        total24h: number;
        uniqUsers24h: number;
        last5m: number;
        last15m: number;
        last60m: number;
      }
    | undefined = undefined;

  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = (await prisma.activityLog.findMany({
      where: {
        timestamp: { gte: since },
        action: { in: ['LOGIN_SUCCESS', 'SESSION_EXTENDED', 'LOGIN', 'PRESENCE_BEAT'] },
      },
      orderBy: { timestamp: 'desc' },
      take: 500,
    })) as Array<{
      userId?: string | null;
      metadata?: unknown;
      ipAddress?: string | null;
      userAgent?: string | null;
      timestamp?: Date | string | null;
    }>;

    const seen = new Map<
      string,
      {
        userId?: string | null;
        email?: string | null;
        ipAddress?: string | null;
        userAgent?: string | null;
        lastSeen?: string | null;
      }
    >();
    const uniqUsers = new Set<string>();

    const metaField = (m: unknown, k: string): string | null => {
      if (!m || typeof m !== 'object') return null;
      const obj = m as Record<string, unknown>;
      const v = obj[k];
      return v == null ? null : String(v);
    };

    const now = Date.now();
    let last5m = 0;
    let last15m = 0;
    let last60m = 0;

    for (const r of rows) {
      const meta = r.metadata;
      const uid = typeof r.userId === 'string' ? r.userId : metaField(meta, 'userId');
      const email = metaField(meta, 'email');
      const ip = typeof r.ipAddress === 'string' ? r.ipAddress : metaField(meta, 'ip');
      const ua = typeof r.userAgent === 'string' ? r.userAgent : metaField(meta, 'ua');
      const ts = r.timestamp ? new Date(r.timestamp as Date | string).getTime() : null;

      if (uid) uniqUsers.add(uid);

      if (ts) {
        const ageMs = now - ts;
        if (ageMs <= 5 * 60 * 1000) last5m++;
        if (ageMs <= 15 * 60 * 1000) last15m++;
        if (ageMs <= 60 * 60 * 1000) last60m++;
      }

      const key = uid ?? (ip || ua ? `${ip ?? ''}|${ua ?? ''}` : JSON.stringify(meta ?? {}));
      if (!seen.has(key)) {
        seen.set(key, {
          userId: uid ?? null,
          email: email ?? null,
          ipAddress: ip ?? null,
          userAgent: ua ?? null,
          lastSeen: ts ? new Date(ts).toISOString() : null,
        });
      }
      if (seen.size >= 200) break;
    }

    activeSessions = Array.from(seen.values());
    sessionSummary = {
      total24h: rows.length,
      uniqUsers24h: uniqUsers.size,
      last5m,
      last15m,
      last60m,
    };
  } catch {}

  // ===== Optional app-level counts =====
  const app: Record<string, number | string> = {};
  try {
    const safeCount = async (label: string, fn: () => Promise<number>) => {
      try {
        const n = await fn();
        app[label] = n;
      } catch {}
    };

    await Promise.allSettled([
      safeCount('users', async () => prisma.user.count()),
      safeCount('courses', async () => prisma.course.count()),
      safeCount('assignments', async () => prisma.assignment.count()),
      safeCount('problems', async () => prisma.problem.count()),
      safeCount('submissions', async () => prisma.submission.count()),
      safeCount('activityLogs24h', async () =>
        prisma.activityLog.count({
          where: { timestamp: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        }),
      ),
    ]);
  } catch {}

  // ===== Network =====
  let network: Record<string, unknown> | undefined = undefined;
  try {
    let dbHost: string | null = null;
    let dbPort: number | null = null;
    if (provider === 'postgres' || provider === 'unknown') {
      try {
        const dbUrlObj = new URL(dbUrl);
        dbHost = dbUrlObj.hostname || null;
        dbPort = dbUrlObj.port ? Number(dbUrlObj.port) : 5432;
      } catch {
        dbHost = null;
        dbPort = null;
      }
    }

    let authHost: string | null = null;
    let authPort: number | null = null;
    let authProtocol: string | null = null;
    try {
      const authUrlObj = new URL(authBase);
      authHost = authUrlObj.hostname || null;
      authPort = authUrlObj.port
        ? Number(authUrlObj.port)
        : authUrlObj.protocol === 'https:'
          ? 443
          : 80;
      authProtocol = authUrlObj.protocol || null;
    } catch {
      authHost = null;
      authPort = null;
      authProtocol = null;
    }

    const [dbResolved, authResolved, authLatencyMs, authCertExpiry] = await Promise.all([
      resolveHost(dbHost),
      resolveHost(authHost),
      measureFetchLatency(authProbeUrl),
      authProtocol === 'https:' ? getTlsExpiry(authHost, authPort) : Promise.resolve(null),
    ]);

    const nowMs = Date.now();
    const since5m = new Date(nowMs - 5 * 60 * 1000);
    const since15m = new Date(nowMs - 15 * 60 * 1000);
    const errorWhere = {
      OR: [
        { action: { contains: 'error', mode: 'insensitive' as const } },
        { action: { contains: 'fail', mode: 'insensitive' as const } },
        { action: { contains: 'denied', mode: 'insensitive' as const } },
        { action: { contains: 'forbidden', mode: 'insensitive' as const } },
      ],
    };

    const [total5m, total15m, err5m, err15m] = await Promise.all([
      prisma.activityLog.count({ where: { timestamp: { gte: since5m } } }),
      prisma.activityLog.count({ where: { timestamp: { gte: since15m } } }),
      prisma.activityLog.count({ where: { timestamp: { gte: since5m }, ...errorWhere } }),
      prisma.activityLog.count({ where: { timestamp: { gte: since15m }, ...errorWhere } }),
    ]);

    const rate = (errors: number, total: number) => (total > 0 ? (errors / total) * 100 : 0);
    const dbConnections =
      database?.stats?.pg?.num_backends ?? database?.details?.pg_active_connections ?? null;

    network = {
      db: {
        host: dbHost,
        port: dbPort,
        resolved: dbResolved,
        latencyMs: dbLatencyMs,
        connections: dbConnections,
      },
      auth: {
        url: authProbeUrl,
        host: authHost,
        port: authPort,
        resolved: authResolved,
        latencyMs: authLatencyMs,
        sslExpiry: authCertExpiry,
      },
      errors: {
        last5m: { total: total5m, errors: err5m, ratePct: rate(err5m, total5m) },
        last15m: { total: total15m, errors: err15m, ratePct: rate(err15m, total15m) },
      },
    };
  } catch {}

  // ===== Build response =====
  const body: Record<string, unknown> = {
    system,
    database,
    env: { public: envPublic, masked: envMaskedSummary },
    ...(activeSessions ? { activeSessions } : {}),
    ...(sessionSummary ? { sessionSummary } : {}),
    app,
    ...(network ? { network } : {}),
    metrics: { provider },
  };

  const t1 = performance.now();
  const latencyMs = Math.round(t1 - t0);
  (body.metrics as Record<string, unknown>).latencyMs = latencyMs;

  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'x-status-latency-ms': String(latencyMs),
    },
  });
}
