'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import pkg from '../../../../package.json';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone, formatTimeInTimeZone } from '@/lib/date';

type IpAddr = { iface?: string; address?: string; family?: string };
type CpuInfo = { model?: string; speed?: number };
type SystemStats = {
  pid?: number;
  cwd?: string;
  tz?: string;
  memProcess?: Record<string, number>;
  memProcessPctOfSystem?: number;
  cpuProcessPct?: number;
  diskIo?: { device?: string; readBytesPerSec?: number; writeBytesPerSec?: number };
  uptimeBreakdown?: { days: number; hours: number; minutes: number; seconds: number };
};
type PgStats = {
  max_connections?: number | null;
  num_backends?: number | null;
  connections_by_state?: Record<string, number>;
  connections_idle_in_xact?: number | null;
  db_size_mb?: number | null;
  top_queries?: Array<{ pid: number; state: string | null; age_ms: number; query_trunc: string }>;
  cache_hit_ratio?: number | null;
  seq_scans?: number | null;
  idx_scans?: number | null;
  transactions_per_sec?: number | null;
  slow_query_count?: number | null;
};
type SqliteStats = {
  journal_mode?: string | null;
  wal_checkpoint?: {
    busy?: number | null;
    log?: number | null;
    checkpointed?: number | null;
  } | null;
};
type DatabaseStats = { pg?: PgStats; sqlite?: SqliteStats };
type DatabaseDetails = {
  version?: string;
  sqlite_version?: string;
  current_database?: string;
  current_time_iso?: string;
  table_count?: number;
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
type DatabaseStatus = {
  ok: boolean;
  message: string;
  details?: DatabaseDetails;
  stats?: DatabaseStats;
};
type NetworkStatus = {
  db?: {
    host?: string | null;
    port?: number | null;
    resolved?: string[] | null;
    latencyMs?: number | null;
    connections?: number | null;
  };
  auth?: {
    url?: string | null;
    host?: string | null;
    port?: number | null;
    resolved?: string[] | null;
    latencyMs?: number | null;
    sslExpiry?: string | null;
  };
  errors?: {
    last5m?: { total?: number; errors?: number; ratePct?: number };
    last15m?: { total?: number; errors?: number; ratePct?: number };
  };
};
type SystemBlock = {
  ok?: boolean;
  uptime?: number;
  processUptime?: number;
  nodeVersion?: string;
  hostname?: string;
  platform?: string;
  release?: string;
  arch?: string;
  cpuCount?: number;
  cpus?: CpuInfo[];
  memory?: { total?: number; free?: number };
  loadavg?: number[];
  ipAddresses?: IpAddr[];
  stats?: SystemStats;
};
type SessionItem = {
  userId?: string | null;
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  lastSeen?: string | null;
};
type SessionSummary = {
  total24h: number;
  uniqUsers24h: number;
  last5m: number;
  last15m: number;
  last60m: number;
};
type SoftwareInfo = {
  deployEnv?: string;
  buildHash?: string;
  imageTag?: string;
};
type DockerInfo = {
  isDocker: boolean;
  containerId?: string;
  containerIdShort?: string;
  hostname?: string;
  envHostname?: string;
  indicators?: string[];
  cgroupPaths?: string[];
};

type StatusResponse = {
  system: SystemBlock;
  database: DatabaseStatus;
  network?: NetworkStatus;
  env?: { public?: Record<string, string>; masked?: Record<string, string> };
  activeSessions?: SessionItem[];
  sessionSummary?: SessionSummary;
  app?: Record<string, number | string>;
  docker?: DockerInfo;
  software?: SoftwareInfo;
  metrics?: { provider?: string; latencyMs?: number };
  abandonedFiles?: {
    total: number;
    byCategory: Record<string, number>;
    samples: Array<{ category: string; fileName: string; path: string }>;
  };
};

/* -------------------- utils -------------------- */
const formatUptime = (secs?: number | null) => {
  if (secs == null || Number.isNaN(Number(secs))) return '—';
  const total = Math.floor(Number(secs));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
};
const formatBytes = (b?: number | null) => {
  if (b == null || Number.isNaN(Number(b))) return '—';
  const bytes = Number(b);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(2)} GB`;
};

const formatDbSize = (bytes?: number | null) => {
  if (bytes == null || Number.isNaN(Number(bytes))) return '—';
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
const formatMs = (ms?: number | null) =>
  typeof ms === 'number' && Number.isFinite(ms) ? `${ms} ms` : '—';
const formatRate = (pct?: number | null) =>
  typeof pct === 'number' && Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—';
const formatDbVersion = (v?: string | null) => {
  if (!v) return '—';
  const pg = v.match(/(PostgreSQL\s+\d+(?:\.\d+)?)/i)?.[1];
  const bits = v.match(/(\d+-bit)/i)?.[1];
  if (pg) return [pg, bits].filter(Boolean).join(' ');
  return v.split(',')[0]?.trim() || v;
};
const toTitleCase = (s?: string | null) =>
  s ? s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) : '—';
const getPkgDep = (name: string) =>
  (pkg.dependencies as Record<string, string> | undefined)?.[name] ??
  (pkg.devDependencies as Record<string, string> | undefined)?.[name] ??
  '—';
const copy = async (text?: string | null) => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
};

/* -------------------- trend storage -------------------- */
type HistoryPoint = {
  ts: number;
  cpuPct?: number;
  memPct?: number;
  diskIoBps?: number;
  dbSizeMB?: number;
  dbTables?: number | null;
  sessions24h?: number;
  latencyMs?: number;
};
const HIST_KEY = 'statusHistory:v1';

const readHistory = (): HistoryPoint[] => {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryPoint[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p?.ts === 'number');
  } catch {
    return [];
  }
};
const writeHistory = (arr: HistoryPoint[]) => {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(arr));
  } catch {
    // ignore
  }
};

function useTrends(sample: HistoryPoint | null, keepHours: number) {
  const [windowHours, setWindowHours] = useState<number>(1);
  const setHours = useCallback(
    (h: number) => {
      setWindowHours(h);
    },
    [setWindowHours],
  );

  const trends = useMemo(() => {
    const hist = readHistory();
    const now = Date.now();

    // Push latest sample and trim (max 24h kept)
    if (sample) {
      const withNew = [...hist.filter((p) => now - p.ts <= keepHours * 3600_000), sample];
      writeHistory(withNew);
    }

    const windowMs = windowHours * 3600_000;
    const windowHist = (sample ? [...readHistory()] : hist).filter((p) => now - p.ts <= windowMs);
    if (windowHist.length < 2) {
      return {
        cpuDelta: 0,
        memDelta: 0,
        dbSizeDelta: 0,
        dbTablesDelta: 0,
        sessionsDelta: 0,
        latencyDelta: 0,
      };
    }
    // compare oldest vs newest for simple trend
    const first = windowHist[0];
    const last = windowHist[windowHist.length - 1];

    const delta = (a?: number | null, b?: number | null) =>
      typeof a === 'number' && typeof b === 'number' ? b - a : 0;

    return {
      cpuDelta: delta(first.cpuPct, last.cpuPct),
      memDelta: delta(first.memPct, last.memPct),
      dbSizeDelta: delta(first.dbSizeMB, last.dbSizeMB),
      dbTablesDelta: delta(first.dbTables ?? null, last.dbTables ?? null),
      sessionsDelta: delta(first.sessions24h, last.sessions24h),
      latencyDelta: delta(first.latencyMs, last.latencyMs),
    };
  }, [sample, windowHours, keepHours]);

  return { windowHours, setHours, trends };
}

/* -------------------- UI bits -------------------- */
const Skel = ({ w = 'w-24' }: { w?: string }) => (
  <div className={`h-4 ${w} bg-muted animate-pulse rounded`} />
);
const Meter = ({ pct, label }: { pct?: number; label: string }) => {
  const v = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  return (
    <div
      className="bg-muted h-2 w-full overflow-hidden rounded"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={v}
      aria-valuetext={`${v}%`}
    >
      <div className="h-full bg-emerald-500" style={{ width: `${v}%` }} />
    </div>
  );
};
const Stat = ({
  label,
  value,
  onCopy,
  copyAriaLabel,
}: {
  label: string;
  value: React.ReactNode;
  onCopy?: () => void;
  copyAriaLabel?: string;
}) => (
  <div className="flex items-start justify-between gap-4">
    <div className="text-muted-foreground text-sm">{label}</div>
    <div className="text-right text-sm break-words">
      {value}
      {onCopy ? (
        <button
          type="button"
          className="text-muted-foreground ml-2 text-xs underline hover:opacity-80"
          onClick={onCopy}
          aria-label={copyAriaLabel ?? `Copy ${label}`}
        >
          Copy
        </button>
      ) : null}
    </div>
  </div>
);

const TrendBadge = ({ delta }: { delta: number }) => {
  const up = delta > 0;
  const flat = Math.abs(delta) < 0.1;
  const variant = flat ? 'neutral' : up ? 'success' : 'danger';
  const arrow = flat ? '•' : up ? '▲' : '▼';
  const mag = Math.abs(delta) < 1 ? delta.toFixed(1) : Math.round(delta);
  return (
    <Badge variant={variant} className="ml-2 text-xs">
      {arrow} {mag}
    </Badge>
  );
};

/* -------------------- Sparkline component -------------------- */
const Sparkline = ({
  points,
  height = 40,
  width = 120,
  label,
}: {
  points: number[];
  height?: number;
  width?: number;
  label?: string;
}) => {
  if (!points || points.length < 2) return <span className="text-muted-foreground text-xs">—</span>;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const normalized = points.map((p) => (p - min) / range);

  const step = width / (points.length - 1);
  const d = normalized
    .map((n, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${height - n * height}`)
    .join(' ');

  const latest = points[points.length - 1];
  const trend = points.length > 1 ? latest - points[0] : 0;
  const trendColor = trend > 0 ? '#ef4444' : trend < 0 ? '#22c55e' : '#94a3b8';

  return (
    <div className="flex flex-col gap-1">
      <svg
        width={width}
        height={height}
        className="stroke-current text-blue-500"
        strokeWidth={1.5}
        fill="none"
      >
        <path d={d} strokeLinecap="round" strokeLinejoin="round" />
        <circle
          cx={width}
          cy={height - normalized[normalized.length - 1] * height}
          r={2}
          fill={trendColor}
        />
      </svg>
      {label && <span className="text-muted-foreground text-xs">{label}</span>}
    </div>
  );
};

export default function SystemStatusClient() {
  const { timezone } = useEffectiveTimezone();
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [deep, setDeep] = useState(false);
  const [deletingFiles, setDeletingFiles] = useState<Record<string, boolean>>({});

  // Live system status, cached per `deep` toggle. Auto-refresh drives the query's
  // own polling interval, replacing the old manual setInterval loop.
  const {
    data: status = null,
    isLoading,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'status', deep],
    queryFn: async () => {
      const r = await fetch(`/api/admin/status${deep ? '?deep=1' : ''}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('Failed to fetch status');
      return (await r.json()) as StatusResponse;
    },
    refetchInterval: autoRefresh ? 15_000 : false,
    staleTime: 0,
  });

  // `loading` gates the skeleton-vs-content: show the skeleton only on the cold
  // first load (isLoading), so a background poll/refresh doesn't blank the status.
  // `refreshing` (any in-flight fetch) drives the Refresh button state.
  const loading = isLoading;
  const refreshing = isFetching;
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  const handleDeleteAbandonedFile = useCallback(
    async (category: string, fileName: string) => {
      const key = `${category}/${fileName}`;
      if (deletingFiles[key]) return;
      const ok = window.confirm(`Delete abandoned file "${fileName}"?`);
      if (!ok) return;

      setDeletingFiles((prev) => ({ ...prev, [key]: true }));
      try {
        const res = await fetch('/api/admin/status/abandoned-files', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, fileName }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => null);
          throw new Error(err?.error || 'Failed to delete file');
        }
        await refetch();
      } catch (err) {
        console.error('Delete abandoned file error:', err);
        window.alert(err instanceof Error ? err.message : 'Failed to delete file');
      } finally {
        setDeletingFiles((prev) => ({ ...prev, [key]: false }));
      }
    },
    [deletingFiles, refetch],
  );

  const dbOk = status?.database?.ok ?? false;
  const provider = status?.metrics?.provider ?? 'unknown';
  const sStats = status?.system?.stats;
  const net = status?.network;

  // Robust DB table & size resolution
  const dbTables: number | null = useMemo(() => {
    const raw = status?.database?.details?.table_count;
    if (typeof raw === 'number' && raw > 0) return raw;
    // treat 0 as unknown rather than misleading; return null to render "—"
    return null;
  }, [status?.database?.details?.table_count]);

  const dbSizeBytes: number | null = useMemo(() => {
    const bytes = status?.database?.details?.pg_database_size_bytes;
    if (typeof bytes === 'number' && bytes >= 0) return bytes;
    const pgStat = status?.database?.stats?.pg?.db_size_mb;
    if (typeof pgStat === 'number' && pgStat >= 0) return pgStat * 1024 * 1024;
    const sqliteApprox = status?.database?.details?.sqlite_approx_file_bytes;
    if (typeof sqliteApprox === 'number' && sqliteApprox >= 0) return sqliteApprox;
    const sqliteFileBytes = status?.database?.details?.sqlite_file_bytes;
    if (typeof sqliteFileBytes === 'number' && sqliteFileBytes >= 0) return sqliteFileBytes;
    return null;
  }, [
    status?.database?.details?.pg_database_size_bytes,
    status?.database?.stats?.pg?.db_size_mb,
    status?.database?.details?.sqlite_approx_file_bytes,
    status?.database?.details?.sqlite_file_bytes,
  ]);

  // Build the sample used for trend calc and persist
  const sample: HistoryPoint | null = useMemo(() => {
    if (!status) return null;
    return {
      ts: Date.now(),
      cpuPct: sStats?.cpuProcessPct,
      memPct: sStats?.memProcessPctOfSystem,
      diskIoBps: (sStats?.diskIo?.readBytesPerSec ?? 0) + (sStats?.diskIo?.writeBytesPerSec ?? 0),
      dbSizeMB: dbSizeBytes ? Math.round(dbSizeBytes / 1024 / 1024) : undefined,
      dbTables: dbTables,
      sessions24h: status.sessionSummary?.total24h,
      latencyMs: status.metrics?.latencyMs,
    };
  }, [
    status,
    sStats?.cpuProcessPct,
    sStats?.memProcessPctOfSystem,
    sStats?.diskIo?.readBytesPerSec,
    sStats?.diskIo?.writeBytesPerSec,
    dbSizeBytes,
    dbTables,
  ]);

  // Trends (keep 24h, window selectable)
  const { windowHours, setHours, trends } = useTrends(sample, 24);

  const sessionSummary = status?.sessionSummary;

  // Summary tiles w/ trend deltas
  const tiles = useMemo(
    () => [
      { label: 'Uptime', value: formatUptime(status?.system?.uptime), delta: 0 },
      {
        label: 'Proc CPU',
        value: `${Math.round(sStats?.cpuProcessPct ?? 0)}%`,
        delta: trends.cpuDelta,
      },
      {
        label: 'Proc Mem',
        value: `${(sStats?.memProcessPctOfSystem ?? 0).toFixed(1)}%`,
        delta: trends.memDelta,
      },
      {
        label: 'DB Tables',
        value: dbTables == null ? '—' : String(dbTables),
        delta: trends.dbTablesDelta,
      },
      { label: 'DB Size', value: formatDbSize(dbSizeBytes), delta: trends.dbSizeDelta },
      {
        label: 'Sessions (24h)',
        value: String(sessionSummary?.total24h ?? 0),
        delta: trends.sessionsDelta,
      },
      { label: 'Unique Users', value: String(sessionSummary?.uniqUsers24h ?? 0), delta: 0 },
      {
        label: 'Latency (ms)',
        value: String(status?.metrics?.latencyMs ?? '—'),
        delta: trends.latencyDelta,
      },
    ],
    [
      status?.system?.uptime,
      sStats?.cpuProcessPct,
      sStats?.memProcessPctOfSystem,
      dbTables,
      dbSizeBytes,
      sessionSummary?.total24h,
      sessionSummary?.uniqUsers24h,
      status?.metrics?.latencyMs,
      trends.cpuDelta,
      trends.memDelta,
      trends.dbSizeDelta,
      trends.dbTablesDelta,
      trends.sessionsDelta,
      trends.latencyDelta,
    ],
  );

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle role="heading" aria-level={1} className="text-2xl">
              System Status
            </CardTitle>
            <Badge
              variant={dbOk ? 'success' : 'danger'}
              title={status?.database?.message || ''}
            >
              DB {dbOk ? 'OK' : 'DOWN'}
            </Badge>
            <Badge variant="info" title="Database provider">
              {(provider || 'unknown').toUpperCase()}
            </Badge>
            {typeof status?.metrics?.latencyMs === 'number' && (
              <Badge variant="warning" title="Endpoint latency">
                {status.metrics.latencyMs} ms
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">Deep</span>
              <Switch
                checked={deep}
                onCheckedChange={setDeep}
                aria-label="Enable deep health checks"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Auto-refresh</span>
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                aria-label="Enable automatic refresh every 15 seconds"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Trend window</span>
              <select
                aria-label="Select trend window"
                className="bg-background rounded border px-2 py-1 text-sm"
                value={windowHours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                <option value={1}>1h</option>
                <option value={6}>6h</option>
                <option value={24}>24h</option>
              </select>
            </div>
            <div className="text-muted-foreground text-xs" aria-live="polite">
              {lastUpdated ? `Updated ${formatTimeInTimeZone(lastUpdated, timezone)}` : ''}
            </div>
            <Button size="sm" onClick={() => refetch()} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>

        {/* Summary tiles */}
        <CardContent className="pb-6">
          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded border p-3">
                  <Skel w="w-16" />
                  <div className="mt-2">
                    <Skel w="w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              {tiles.map((t) => (
                <div key={t.label} className="rounded border p-3">
                  <div className="text-muted-foreground text-xs">{t.label}</div>
                  <div className="mt-1 text-lg font-semibold">
                    {t.value}
                    <TrendBadge delta={t.delta} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* DB tables caution if zero but DB reachable */}
          {!loading && dbOk && status?.database?.details?.table_count === 0 && (
            <div className="mt-3 text-xs text-amber-700">
              Heads up: reported <strong>0 tables</strong>. This might indicate limited DB
              permissions or a non-default schema. Try toggling <em>Deep</em> or verify the DB user
              can read system catalogs.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Skeleton while loading */}
      {loading && (
        <Card>
          <CardContent className="grid gap-4 p-6 sm:grid-cols-2">
            <Skel w="w-40" />
            <Skel w="w-32" />
            <Skel w="w-28" />
            <Skel w="w-24" />
            <Skel w="w-56" />
            <Skel w="w-36" />
          </CardContent>
        </Card>
      )}

      {/* Main content */}
      {!loading && status && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* System Overview (CPUs included) */}
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-lg">
                Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              {/* Basic stats */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Stat
                  label="Arch / CPUs"
                  value={`${status.system?.arch ?? '—'} / ${status.system?.cpuCount ?? status.system?.cpus?.length ?? '—'}`}
                />
                <Stat
                  label="Memory"
                  value={
                    status.system?.memory
                      ? `${formatBytes(status.system.memory.total)} total — ${formatBytes(status.system.memory.free)} free`
                      : '—'
                  }
                />
              </div>

              {/* Process meters */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">CPU (process)</span>
                    <span>{Math.round(sStats?.cpuProcessPct ?? 0)}%</span>
                  </div>
                  <Meter pct={sStats?.cpuProcessPct} label="CPU process usage" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Memory (process / system)</span>
                    <span>{(sStats?.memProcessPctOfSystem ?? 0).toFixed(1)}%</span>
                  </div>
                  <Meter pct={sStats?.memProcessPctOfSystem} label="Process memory usage" />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-4">
                  <div className="space-y-2 rounded border p-3">
                    <div className="text-muted-foreground text-xs font-semibold">
                      CPU % (last {windowHours}h)
                    </div>
                    <Sparkline
                      points={readHistory()
                        .filter((p) => Date.now() - p.ts <= windowHours * 3600_000)
                        .map((p) => p.cpuPct ?? 0)}
                      width={100}
                      height={30}
                    />
                  </div>
                  <div className="space-y-2 rounded border p-3">
                    <div className="text-muted-foreground text-xs font-semibold">
                      Latency (ms) (last {windowHours}h)
                    </div>
                    <Sparkline
                      points={readHistory()
                        .filter((p) => Date.now() - p.ts <= windowHours * 3600_000)
                        .map((p) => p.latencyMs ?? 0)}
                      width={100}
                      height={30}
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2 rounded border p-3">
                    <div className="text-muted-foreground text-xs font-semibold">
                      Mem % (last {windowHours}h)
                    </div>
                    <Sparkline
                      points={readHistory()
                        .filter((p) => Date.now() - p.ts <= windowHours * 3600_000)
                        .map((p) => p.memPct ?? 0)}
                      width={100}
                      height={30}
                    />
                  </div>
                  <div className="space-y-2 rounded border p-3">
                    <div className="text-muted-foreground text-xs font-semibold">
                      Disk IO (MB/s) (last {windowHours}h)
                    </div>
                    <Sparkline
                      points={readHistory()
                        .filter((p) => Date.now() - p.ts <= windowHours * 3600_000)
                        .map((p) => (p.diskIoBps ?? 0) / 1024 / 1024)}
                      width={100}
                      height={30}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-lg">
                Software
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Stat label="AFCT Dashboard" value={pkg.version} />
              <Stat label="AFCT Evaluator" value={status.app?.evaluatorVersion ?? '—'} />
              <Stat
                label="Deployment Environment"
                value={toTitleCase(status.software?.deployEnv)}
              />
              <Stat label="Node" value={status.system?.nodeVersion ?? '—'} />
              <Stat label="Next.js" value={getPkgDep('next')} />
              <Stat label="Java" value={status.app?.javaVersion ?? '—'} />
              {status.database?.details?.version && (
                <Stat label="Database" value={formatDbVersion(status.database.details.version)} />
              )}
              {status.database?.details?.sqlite_version && (
                <Stat label="SQLite Version" value={status.database.details.sqlite_version} />
              )}

              <Stat
                label="OS / Arch"
                value={`${status.system?.platform ?? '—'}${status.system?.release ? ` ${status.system.release}` : ''} / ${status.system?.arch ?? '—'}`}
              />
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader className="flex items-center justify-between">
              <CardTitle role="heading" aria-level={2} className="text-lg">
                Database Overview
              </CardTitle>
              <Badge variant={dbOk ? 'success' : 'danger'}>
                {dbOk ? 'OK' : 'DOWN'}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="mb-3 text-sm">
                <span className="text-muted-foreground">Message: </span>
                {status.database?.message ?? '—'}
              </div>

              {/* Two column layout */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Left column */}
                <div className="space-y-4">
                  {/* Migrations */}
                  {status.database?.details?.last_migration_name && (
                    <div>
                      <div className="text-muted-foreground mb-2 text-sm font-semibold">
                        Last Migration
                      </div>
                      <div className="space-y-2">
                        <Stat
                          label="Name"
                          value={status.database.details.last_migration_name}
                          onCopy={() => copy(status.database?.details?.last_migration_name)}
                        />
                        <Stat
                          label="Finished At"
                          value={
                            status.database.details.last_migration_finished_at
                              ? formatDateTimeInTimeZone(
                                  new Date(status.database.details.last_migration_finished_at),
                                  timezone,
                                )
                              : '—'
                          }
                        />
                      </div>
                    </div>
                  )}

                  {/* Details */}
                  <div>
                    <div className="text-muted-foreground mb-2 text-sm font-semibold">Details</div>
                    <div className="space-y-2">
                      {status.database?.details?.current_time_iso && (
                        <Stat
                          label="DB Time"
                          value={formatDateTimeInTimeZone(
                            status.database.details.current_time_iso,
                            timezone,
                          )}
                        />
                      )}
                      {status.database?.details?.current_database && (
                        <Stat label="DB Name" value={status.database.details.current_database} />
                      )}
                      <Stat label="Tables" value={dbTables == null ? '—' : dbTables} />
                      <Stat label="DB Size" value={formatDbSize(dbSizeBytes)} />
                      {status.database?.details?.sqlite_file_path && (
                        <Stat
                          label="SQLite file"
                          value={
                            <>
                              <span>{status.database.details.sqlite_file_path}</span>
                              {status.database.details.sqlite_file_bytes ? (
                                <span className="text-muted-foreground">
                                  {' '}
                                  (
                                  {(
                                    Number(status.database.details.sqlite_file_bytes) /
                                    1024 /
                                    1024
                                  ).toFixed(2)}{' '}
                                  MB)
                                </span>
                              ) : null}
                            </>
                          }
                          onCopy={() => copy(status.database!.details!.sqlite_file_path!)}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Right column */}
                <div className="space-y-4">
                  {/* Performance (PostgreSQL only) */}
                  {status.database?.stats?.pg && (
                    <div>
                      <div className="text-muted-foreground mb-2 text-sm font-semibold">
                        Performance
                      </div>
                      <div className="space-y-2">
                        {status.database.stats.pg.cache_hit_ratio != null && (
                          <Stat
                            label="Cache Hit Ratio"
                            value={`${status.database.stats.pg.cache_hit_ratio}%`}
                          />
                        )}
                        {status.database.stats.pg.seq_scans != null && (
                          <Stat
                            label="Sequential Scans"
                            value={status.database.stats.pg.seq_scans}
                          />
                        )}
                        {status.database.stats.pg.idx_scans != null && (
                          <Stat label="Index Scans" value={status.database.stats.pg.idx_scans} />
                        )}
                        {status.database.stats.pg.transactions_per_sec != null && (
                          <Stat
                            label="Transactions/sec"
                            value={status.database.stats.pg.transactions_per_sec}
                          />
                        )}
                        {status.database.stats.pg.slow_query_count != null && (
                          <Stat
                            label="Slow Queries (>5s)"
                            value={status.database.stats.pg.slow_query_count}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Network */}
          <Card>
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="text-lg">
                Network
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Stat label="Hostname" value={status.system?.hostname ?? '—'} />
              <Stat label="DB Latency" value={formatMs(net?.db?.latencyMs)} />
              <Stat label="Auth Latency" value={formatMs(net?.auth?.latencyMs)} />
              <Stat
                label="DB Connections"
                value={
                  typeof net?.db?.connections === 'number' ? String(net?.db?.connections) : '—'
                }
              />
              <Stat
                label="Error rate (5m)"
                value={
                  net?.errors?.last5m
                    ? `${net.errors.last5m.errors ?? 0}/${net.errors.last5m.total ?? 0} (${formatRate(
                        net.errors.last5m.ratePct ?? 0,
                      )})`
                    : '—'
                }
              />
              <Stat
                label="Error rate (15m)"
                value={
                  net?.errors?.last15m
                    ? `${net.errors.last15m.errors ?? 0}/${net.errors.last15m.total ?? 0} (${formatRate(
                        net.errors.last15m.ratePct ?? 0,
                      )})`
                    : '—'
                }
              />
              <Stat
                label="SSL cert expiry"
                value={
                  net?.auth?.sslExpiry
                    ? formatDateTimeInTimeZone(net.auth.sslExpiry, timezone)
                    : '—'
                }
              />
              <Stat
                label="DB DNS"
                value={
                  (net?.db?.resolved ?? []).length ? (net?.db?.resolved ?? []).join(', ') : '—'
                }
              />
              <Stat
                label="Auth DNS"
                value={
                  (net?.auth?.resolved ?? []).length ? (net?.auth?.resolved ?? []).join(', ') : '—'
                }
              />
              <div>
                <div className="text-muted-foreground mb-1 text-sm">IP Addresses</div>
                {(status.system?.ipAddresses?.length ?? 0) > 0 ? (
                  <ul className="divide-y rounded border">
                    {(status.system!.ipAddresses as IpAddr[]).map((ip, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 p-2">
                        <div className="text-sm">
                          <span>{ip.iface ?? 'eth'}</span>: <span>{ip.address}</span>{' '}
                          <span className="text-muted-foreground">
                            {ip.family ? `(${ip.family})` : ''}
                          </span>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => copy(ip.address)}
                          aria-label={`Copy IP address ${ip.address ?? ''}`}
                        >
                          Copy
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm">—</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* App counts + Sessions + Abandoned files */}
      {!loading && status && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader className="flex items-center justify-between">
              <CardTitle role="heading" aria-level={2} className="text-lg">
                Abandoned Files
              </CardTitle>
              <Badge variant="neutral">
                Total: {status.abandonedFiles?.total ?? 0}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Object.entries(status.abandonedFiles?.byCategory ?? {}).map(([k, v]) => (
                  <Stat key={k} label={k} value={v} />
                ))}
              </div>

              {status.abandonedFiles?.samples?.length ? (
                <div className="rounded border">
                  <div className="text-muted-foreground border-b px-3 py-2 text-xs font-semibold">
                    Sample files (max 50)
                  </div>
                  <ul className="max-h-56 overflow-auto px-3 py-2 text-xs">
                    {status.abandonedFiles.samples.map((f, i) => {
                      const key = `${f.category}/${f.fileName}`;
                      const isDeleting = deletingFiles[key];
                      return (
                        <li
                          key={`${f.category}-${f.fileName}-${i}`}
                          className="mb-1 flex items-start justify-between gap-2 last:mb-0"
                        >
                          <div className="min-w-0">
                            <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase">
                              {f.category}
                            </span>
                            <span className="break-all">{f.path}</span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isDeleting}
                            onClick={() => handleDeleteAbandonedFile(f.category, f.fileName)}
                            aria-label={`Delete abandoned file ${f.fileName}`}
                          >
                            {isDeleting ? 'Deleting…' : 'Delete'}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <div className="text-sm">No abandoned files found.</div>
              )}
            </CardContent>
          </Card>

          {status.docker?.isDocker ? (
            <Card>
              <CardHeader>
                <CardTitle role="heading" aria-level={2} className="text-lg">
                  Docker
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Stat
                  label="Container ID"
                  value={status.docker.containerIdShort ?? status.docker.containerId ?? '—'}
                  onCopy={
                    status.docker.containerId
                      ? () => copy(status.docker?.containerId ?? '')
                      : undefined
                  }
                />
                <Stat
                  label="Hostname"
                  value={status.docker.envHostname ?? status.docker.hostname ?? '—'}
                />
                <Stat
                  label="Indicators"
                  value={
                    (status.docker.indicators ?? []).length
                      ? (status.docker.indicators ?? []).join(', ')
                      : '—'
                  }
                />
                <div>
                  <div className="text-muted-foreground mb-1 text-sm">Cgroup</div>
                  {status.docker.cgroupPaths?.length ? (
                    <ul className="divide-y rounded border">
                      {status.docker.cgroupPaths.slice(0, 6).map((line, i) => (
                        <li key={i} className="px-2 py-1 text-xs break-all">
                          {line}
                        </li>
                      ))}
                      {status.docker.cgroupPaths.length > 6 ? (
                        <li className="text-muted-foreground px-2 py-1 text-xs">
                          +{status.docker.cgroupPaths.length - 6} more
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <div className="text-sm">—</div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      {/* Active sessions table */}
      {!loading && status && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle role="heading" aria-level={2} className="text-lg">
              Sessions
              {sessionSummary ? (
                <span className="ml-2 space-x-2">
                  <Badge variant="neutral">
                    24h: {sessionSummary.total24h}
                  </Badge>
                  <Badge variant="neutral">
                    Users: {sessionSummary.uniqUsers24h}
                  </Badge>
                  <Badge variant="neutral">
                    5m: {sessionSummary.last5m}
                  </Badge>
                  <Badge variant="neutral">
                    15m: {sessionSummary.last15m}
                  </Badge>
                  <Badge variant="neutral">
                    60m: {sessionSummary.last60m}
                  </Badge>
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Sessions summary */}
            {sessionSummary ? (
              <div>
                <div className="text-muted-foreground mb-2 text-sm">Session summary</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Total (24h)" value={sessionSummary.total24h} />
                  <Stat label="Unique users (24h)" value={sessionSummary.uniqUsers24h} />
                  <Stat label="Last 5m" value={sessionSummary.last5m} />
                  <Stat label="Last 15m" value={sessionSummary.last15m} />
                  <Stat label="Last 60m" value={sessionSummary.last60m} />
                </div>
              </div>
            ) : null}

            {/* Active sessions table */}
            {status.activeSessions?.length ? (
              <div>
                <div className="text-muted-foreground mb-2 text-sm">Active sessions (last 24h)</div>
                <div className="overflow-auto rounded border">
                  <table className="w-full text-sm" aria-label="Active sessions table">
                    <caption className="sr-only">Active sessions seen in the last 24 hours</caption>
                    <thead className="text-muted-foreground text-left text-xs">
                      <tr className="border-b">
                        <th className="py-2 pr-3">User</th>
                        <th className="py-2 pr-3">IP</th>
                        <th className="py-2 pr-3">Last Seen</th>
                        <th className="py-2">User Agent</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.activeSessions!.map((s, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-3">
                            <div className="font-medium">{s.email ?? s.userId ?? 'Unknown'}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <span>{s.ipAddress ?? '—'}</span>
                              {s.ipAddress ? (
                                <button
                                  type="button"
                                  className="text-muted-foreground text-xs underline hover:opacity-80"
                                  onClick={() => copy(s.ipAddress)}
                                  aria-label={`Copy IP address ${s.ipAddress}`}
                                >
                                  Copy
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-2 pr-3">
                            {s.lastSeen ? formatDateTimeInTimeZone(s.lastSeen, timezone) : '—'}
                          </td>
                          <td className="py-2">
                            <div className="max-w-[50ch] truncate" title={s.userAgent ?? ''}>
                              {s.userAgent ?? '—'}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-sm">No active sessions found.</div>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && !status && (
        <Card>
          <CardContent className="p-6">No status available</CardContent>
        </Card>
      )}
    </div>
  );
}
