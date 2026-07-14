import { prisma } from '@/lib/prisma';
import { collectSystem } from '@/lib/status/server';
import { detectProvider } from '@/lib/status/database';
import type { SummaryStatus } from '@/lib/status/types';

/** Light DB reachability + size/table count for the summary cards (no engine stats). */
async function dbSummary(): Promise<{
  ok: boolean;
  message: string;
  tables: number | null;
  sizeBytes: number | null;
}> {
  const provider = detectProvider(process.env.DATABASE_URL ?? '');
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    const message =
      typeof err === 'object' && err !== null && 'message' in err
        ? String((err as { message?: unknown }).message ?? 'unknown')
        : String(err ?? 'unknown');
    return { ok: false, message, tables: null, sizeBytes: null };
  }

  let tables: number | null = null;
  let sizeBytes: number | null = null;

  if (provider === 'postgres' || provider === 'unknown') {
    try {
      const res = (await prisma.$queryRaw`
        SELECT count(*)::int AS cnt FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind IN ('r','p','f')
          AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      `) as Array<{ cnt?: number }>;
      const cnt = res?.[0]?.cnt;
      if (typeof cnt === 'number' && cnt > 0) tables = cnt;
    } catch {}
    try {
      const res = (await prisma.$queryRaw`
        SELECT pg_database_size(current_database())::bigint AS size
      `) as Array<{ size?: number | bigint }>;
      const size = res?.[0]?.size;
      if (typeof size === 'bigint') sizeBytes = Number(size);
      else if (typeof size === 'number') sizeBytes = size;
    } catch {}
  }

  if ((provider === 'sqlite' || provider === 'unknown') && tables == null) {
    try {
      const t = (await prisma.$queryRawUnsafe(
        `SELECT count(*) as count FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
      )) as Array<{ count?: number }>;
      const cnt = t?.[0]?.count;
      if (typeof cnt === 'number' && cnt > 0) tables = cnt;
    } catch {}
    if (sizeBytes == null) {
      try {
        const pc = (await prisma.$queryRawUnsafe(`PRAGMA page_count`)) as Array<{
          page_count?: number;
        }>;
        const ps = (await prisma.$queryRawUnsafe(`PRAGMA page_size`)) as Array<{
          page_size?: number;
        }>;
        const count = pc?.[0]?.page_count ?? 0;
        const size = ps?.[0]?.page_size ?? 0;
        if (count && size) sizeBytes = count * size;
      } catch {}
    }
  }

  return { ok: true, message: 'reachable', tables, sizeBytes };
}

/** Light 24h session counts (no per-record dedup scan). */
async function sessionSummary(): Promise<{ total24h: number; uniqueUsers24h: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const where = {
    timestamp: { gte: since },
    action: { in: ['LOGIN_SUCCESS', 'SESSION_EXTENDED', 'LOGIN', 'PRESENCE_BEAT'] },
  };
  try {
    const [total24h, groups] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.groupBy({
        by: ['userId'],
        where: { ...where, userId: { not: null } },
      }),
    ]);
    return { total24h, uniqueUsers24h: groups.length };
  } catch {
    return { total24h: 0, uniqueUsers24h: 0 };
  }
}

/**
 * The cross-cutting numbers for the top status cards, fast by design (a single
 * ~100ms CPU sample + a handful of light queries), so it can load immediately
 * while the per-tab detail is fetched lazily.
 */
export async function collectSummary(): Promise<SummaryStatus> {
  const provider = detectProvider(process.env.DATABASE_URL ?? '');
  const [system, db, sessions] = await Promise.all([
    collectSystem(),
    dbSummary(),
    sessionSummary(),
  ]);

  return {
    db: { ok: db.ok, message: db.message, provider },
    uptime: system.uptime,
    procCpuPct: system.stats?.cpuProcessPct,
    procMemPct: system.stats?.memProcessPctOfSystem,
    dbTables: db.tables,
    dbSizeBytes: db.sizeBytes,
    sessions24h: sessions.total24h,
    uniqueUsers24h: sessions.uniqueUsers24h,
  };
}
