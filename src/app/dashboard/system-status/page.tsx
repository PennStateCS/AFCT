"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import pkg from '../../../../package.json';
import { useEffectiveTimezone } from "@/hooks/use-effective-timezone";
import { formatDateTimeInTimeZone, formatTimeInTimeZone } from "@/lib/date";

type IpAddr = { iface?: string; address?: string; family?: string };
type CpuInfo = { model?: string; speed?: number };
type SystemStats = {
  pid?: number;
  cwd?: string;
  tz?: string;
  memProcess?: Record<string, number>;
  memProcessPctOfSystem?: number;
  cpuProcessPct?: number;
  uptimeBreakdown?: { days: number; hours: number; minutes: number; seconds: number };
};
type PgStats = {
  max_connections?: number | null;
  num_backends?: number | null;
  connections_by_state?: Record<string, number>;
  connections_idle_in_xact?: number | null;
  db_size_mb?: number | null;
  top_queries?: Array<{ pid: number; state: string | null; age_ms: number; query_trunc: string }>;
};
type SqliteStats = {
  journal_mode?: string | null;
  wal_checkpoint?: { busy?: number | null; log?: number | null; checkpointed?: number | null } | null;
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
type SessionSummary = { total24h: number; uniqUsers24h: number; last5m: number; last15m: number; last60m: number };

type StatusResponse = {
  system: SystemBlock;
  database: DatabaseStatus;
  env?: { public?: Record<string, string>; masked?: Record<string, string> };
  activeSessions?: SessionItem[];
  sessionSummary?: SessionSummary;
  app?: Record<string, number | string>;
  metrics?: { provider?: string; latencyMs?: number };
};

/* -------------------- utils -------------------- */
const formatUptime = (secs?: number | null) => {
  if (secs == null || Number.isNaN(Number(secs))) return "—";
  const total = Math.floor(Number(secs));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
};
const formatBytes = (b?: number | null) => {
  if (b == null || Number.isNaN(Number(b))) return "—";
  const bytes = Number(b);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(2)} GB`;
};

const formatDbSize = (bytes?: number | null) => {
  if (bytes == null || Number.isNaN(Number(bytes))) return "—";
  const b = Number(bytes);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
};
const formatLoad = (arr?: number[] | null) => {
  if (!Array.isArray(arr) || arr.length === 0) return "—";
  return arr.map((n) => n.toFixed(2)).join(" / ");
};
const copy = async (text?: string | null) => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
};

/* -------------------- trend storage -------------------- */
type HistoryPoint = {
  ts: number;
  cpuPct?: number;
  memPct?: number;
  dbSizeMB?: number;
  dbTables?: number | null;
  sessions24h?: number;
  latencyMs?: number;
};
const HIST_KEY = "statusHistory:v1";

const readHistory = (): HistoryPoint[] => {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryPoint[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => typeof p?.ts === "number");
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
    [setWindowHours]
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
      typeof a === "number" && typeof b === "number" ? b - a : 0;

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
const Skel = ({ w = "w-24" }: { w?: string }) => <div className={`h-4 ${w} animate-pulse rounded bg-muted`} />;
const Meter = ({ pct }: { pct?: number }) => {
  const v = Math.max(0, Math.min(100, Math.round(pct ?? 0)));
  return (
    <div className="h-2 w-full overflow-hidden rounded bg-muted" aria-label="meter">
      <div className="h-full" style={{ width: `${v}%` }} />
    </div>
  );
};
const Stat = ({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: React.ReactNode;
  onCopy?: () => void;
}) => (
  <div className="flex items-start justify-between gap-4">
    <div className="text-sm text-muted-foreground">{label}</div>
    <div className="text-sm text-right break-words">
      {value}
      {onCopy ? (
        <button className="ml-2 text-xs text-muted-foreground underline hover:opacity-80" onClick={onCopy}>
          Copy
        </button>
      ) : null}
    </div>
  </div>
);

const TrendBadge = ({ delta }: { delta: number }) => {
  const up = delta > 0;
  const flat = Math.abs(delta) < 0.1;
  const cls = flat
    ? "bg-slate-50 text-slate-700"
    : up
    ? "bg-emerald-50 text-emerald-700"
    : "bg-rose-50 text-rose-700";
  const arrow = flat ? "•" : up ? "▲" : "▼";
  const mag = Math.abs(delta) < 1 ? delta.toFixed(1) : Math.round(delta);
  return (
    <span className={`ml-2 inline-flex items-center rounded px-2 py-0.5 text-xs ${cls}`}>
      {arrow} {mag}
    </span>
  );
};

/* -------------------- page -------------------- */
export default function SystemStatusPage() {
  const { timezone } = useEffectiveTimezone();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [deep, setDeep] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<number | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/status${deep ? "?deep=1" : ""}`, { cache: "no-store" });
      const data = (await r.json()) as StatusResponse;
      setStatus(data);
      setLastUpdated(new Date());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [deep]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = window.setInterval(fetchStatus, 15_000);
    } else if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [autoRefresh, fetchStatus]);

  const dbOk = status?.database?.ok ?? false;
  const provider = status?.metrics?.provider ?? "unknown";
  const sStats = status?.system?.stats;

  // Robust DB table & size resolution
  const dbTables: number | null = useMemo(() => {
    const raw = status?.database?.details?.table_count;
    if (typeof raw === "number" && raw > 0) return raw;
    // treat 0 as unknown rather than misleading; return null to render "—"
    return null;
  }, [status?.database?.details?.table_count]);

  const dbSizeBytes: number | null = useMemo(() => {
    const bytes = status?.database?.details?.pg_database_size_bytes;
    if (typeof bytes === "number" && bytes >= 0) return bytes;
    const pgStat = status?.database?.stats?.pg?.db_size_mb;
    if (typeof pgStat === "number" && pgStat >= 0) return pgStat * 1024 * 1024;
    const sqliteApprox = status?.database?.details?.sqlite_approx_file_bytes;
    if (typeof sqliteApprox === "number" && sqliteApprox >= 0) return sqliteApprox;
    const sqliteFileBytes = status?.database?.details?.sqlite_file_bytes;
    if (typeof sqliteFileBytes === "number" && sqliteFileBytes >= 0) return sqliteFileBytes;
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
      dbSizeMB: dbSizeBytes ? Math.round(dbSizeBytes / 1024 / 1024) : undefined,
      dbTables: dbTables,
      sessions24h: status.sessionSummary?.total24h,
      latencyMs: status.metrics?.latencyMs,
    };
  }, [status, sStats?.cpuProcessPct, sStats?.memProcessPctOfSystem, dbSizeBytes, dbTables]);

  // Trends (keep 24h, window selectable)
  const { windowHours, setHours, trends } = useTrends(sample, 24);

  const sqlite = status?.database?.stats?.sqlite;
  const sessionSummary = status?.sessionSummary;

  // Summary tiles w/ trend deltas
  const tiles = useMemo(
    () => [
      { label: "Uptime", value: formatUptime(status?.system?.uptime), delta: 0 },
      { label: "Proc CPU", value: `${Math.round(sStats?.cpuProcessPct ?? 0)}%`, delta: trends.cpuDelta },
      { label: "Proc Mem", value: `${(sStats?.memProcessPctOfSystem ?? 0).toFixed(1)}%`, delta: trends.memDelta },
      { label: "DB Tables", value: dbTables == null ? "—" : String(dbTables), delta: trends.dbTablesDelta },
      { label: "DB Size", value: formatDbSize(dbSizeBytes), delta: trends.dbSizeDelta },
      { label: "Sessions (24h)", value: String(sessionSummary?.total24h ?? 0), delta: trends.sessionsDelta },
      { label: "Unique Users", value: String(sessionSummary?.uniqUsers24h ?? 0), delta: 0 },
      { label: "Latency (ms)", value: String(status?.metrics?.latencyMs ?? "—"), delta: trends.latencyDelta },
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
    ]
  );

  return (
    <div className="space-y-4 pb-8">
      {/* Header */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-2xl">System Status</CardTitle>
            <Badge
              variant="outline"
              className={`${dbOk ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
              title={status?.database?.message || ""}
            >
              DB {dbOk ? "OK" : "DOWN"}
            </Badge>
            <Badge variant="outline" className="bg-blue-50 text-blue-700" title="Database provider">
              {(provider || "unknown").toUpperCase()}
            </Badge>
            {typeof status?.metrics?.latencyMs === "number" && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700" title="Endpoint latency">
                {status.metrics.latencyMs} ms
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">Deep</span>
              <Switch checked={deep} onCheckedChange={setDeep} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Auto-refresh</span>
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Trend window</span>
              <select
                className="rounded border bg-background px-2 py-1 text-sm"
                value={windowHours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                <option value={1}>1h</option>
                <option value={6}>6h</option>
                <option value={24}>24h</option>
              </select>
            </div>
            <div className="text-xs text-muted-foreground">
              {lastUpdated ? `Updated ${formatTimeInTimeZone(lastUpdated, timezone)}` : ""}
            </div>
            <Button size="sm" onClick={fetchStatus} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
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
                  <div className="text-xs text-muted-foreground">{t.label}</div>
                  <div className="mt-1 text-lg font-semibold">
                    {t.value}
                    <TrendBadge delta={t.delta} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* DB tables caution if zero but DB reachable */}
          {!loading && dbOk && (status?.database?.details?.table_count === 0) && (
            <div className="mt-3 text-xs text-amber-700">
              Heads up: reported <strong>0 tables</strong>. This might indicate limited DB permissions or a non-default
              schema. Try toggling <em>Deep</em> or verify the DB user can read system catalogs.
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
              <CardTitle className="text-lg">System Overview</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              {/* Basic stats */}
              <div className="grid gap-4 sm:grid-cols-2">
                <Stat label="App Version" value={pkg.version} />
                <Stat label="System Uptime" value={formatUptime(status.system?.uptime)} />
                <Stat
                  label="Node / Process"
                  value={
                    <>
                      {status.system?.nodeVersion ?? "—"} — {formatUptime(status.system?.processUptime)}
                    </>
                  }
                />
                <Stat
                  label="Platform"
                  value={`${status.system?.platform ?? "—"}${status.system?.release ? ` ${status.system.release}` : ""}`}
                />
                <Stat
                  label="Arch / CPUs"
                  value={`${status.system?.arch ?? "—"} / ${status.system?.cpuCount ?? status.system?.cpus?.length ?? "—"}`}
                />
                <Stat
                  label="Memory"
                  value={
                    status.system?.memory
                      ? `${formatBytes(status.system.memory.total)} total — ${formatBytes(status.system.memory.free)} free`
                      : "—"
                  }
                />
                <Stat label="Load avg (1/5/15)" value={formatLoad(status.system?.loadavg)} />
              </div>

              {/* Process meters */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">CPU (process)</span>
                    <span>{Math.round(sStats?.cpuProcessPct ?? 0)}%</span>
                  </div>
                  <Meter pct={sStats?.cpuProcessPct} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Memory (process / system)</span>
                    <span>{(sStats?.memProcessPctOfSystem ?? 0).toFixed(1)}%</span>
                  </div>
                  <Meter pct={sStats?.memProcessPctOfSystem} />
                </div>
              </div>

              {/* CPU details */}
              <div>
                <div className="mb-2 text-sm text-muted-foreground">CPU Details</div>
                {status.system?.cpus?.length ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {status.system.cpus.slice(0, 12).map((c, i) => (
                      <div key={i} className="flex items-center justify-between rounded border p-2 text-sm">
                        <div className="truncate">{c.model ?? "n/a"}</div>
                        <div className="ml-2 text-muted-foreground">{c.speed ?? "n/a"} MHz</div>
                      </div>
                    ))}
                    {status.system.cpus.length > 12 ? (
                      <div className="self-center text-sm text-muted-foreground">+{status.system.cpus.length - 12} more</div>
                    ) : null}
                  </div>
                ) : (
                  <div className="text-sm">—</div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Network */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Network</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Stat
                label="Hostname"
                value={status.system?.hostname ?? "—"}
                
              />
              <div>
                <div className="mb-1 text-sm text-muted-foreground">IP Addresses</div>
                {(status.system?.ipAddresses?.length ?? 0) > 0 ? (
                  <ul className="divide-y rounded border">
                    {(status.system!.ipAddresses as IpAddr[]).map((ip, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 p-2">
                        <div className="text-sm">
                          <span>{ip.iface ?? "eth"}</span>: <span>{ip.address}</span>{" "}
                          <span className="text-muted-foreground">{ip.family ? `(${ip.family})` : ""}</span>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => copy(ip.address)}>
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

          {/* Database */}
          <Card className="xl:col-span-2">
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="text-lg">Database</CardTitle>
              <Badge variant="outline" className={`${dbOk ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                {dbOk ? "OK" : "DOWN"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Message: </span>
                {status.database?.message ?? "—"}
              </div>

              {/* Details */}
              <div className="grid gap-4 sm:grid-cols-2">
                {status.database?.details?.current_time_iso && (
                  <Stat label="DB Time" value={formatDateTimeInTimeZone(status.database.details.current_time_iso, timezone)} />
                )}
                {status.database?.details?.current_database && (
                  <Stat label="DB Name" value={status.database.details.current_database} />
                )}
                {status.database?.details?.version && <Stat label="Version" value={status.database.details.version} />}
                {status.database?.details?.sqlite_version && (
                  <Stat label="SQLite Version" value={status.database.details.sqlite_version} />
                )}
                <Stat label="Tables" value={dbTables == null ? "—" : dbTables} />
                <Stat label="DB Size" value={formatDbSize(dbSizeBytes)} />
                {status.database?.details?.sqlite_file_path && (
                  <Stat
                    label="SQLite file"
                    value={
                      <>
                        <span>{status.database.details.sqlite_file_path}</span>
                        {status.database.details.sqlite_file_bytes ? (
                          <span className="text-muted-foreground">
                            {" "}
                            ({(Number(status.database.details.sqlite_file_bytes) / 1024 / 1024).toFixed(2)} MB)
                          </span>
                        ) : null}
                      </>
                    }
                    onCopy={() => copy(status.database!.details!.sqlite_file_path!)}
                  />
                )}
                {status.database?.details?.last_migration_name && (
                  <Stat
                    label="Last Migration"
                    value={
                      <>
                        <span>{status.database!.details!.last_migration_name}</span>
                        {status.database!.details!.last_migration_finished_at ? (
                          <span className="text-muted-foreground">
                            {" "}
                            — {formatDateTimeInTimeZone(status.database!.details!.last_migration_finished_at!, timezone)}
                          </span>
                        ) : null}
                      </>
                    }
                  />
                )}
              </div>

              {/* Provider-specific extras */}
              {status.database?.stats?.pg && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Stat label="max_connections" value={status.database.stats.pg.max_connections ?? "—"} />
                  <Stat label="num_backends" value={status.database.stats.pg.num_backends ?? "—"} />
                  <Stat label="idle in xact" value={status.database.stats.pg.connections_idle_in_xact ?? "—"} />
                  <Stat label="DB size (MB)" value={status.database.stats.pg.db_size_mb ?? "—"} />
                  {status.database.stats.pg.connections_by_state && (
                    <div className="sm:col-span-2">
                      <div className="mb-1 text-sm text-muted-foreground">Connections by state</div>
                      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
                        {Object.entries(status.database.stats.pg.connections_by_state).map(([state, cnt]) => (
                          <li key={state} className="rounded border p-2 text-sm">
                            <div className="flex items-center justify-between">
                              <span className="truncate">{state}</span>
                              <span>{cnt}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {status.database?.stats?.pg?.top_queries &&
                status.database.stats.pg.top_queries.length > 0 && (
                  <div className="overflow-x-auto">
                    <div className="mb-2 text-sm text-muted-foreground">Top running/idle-in-xact queries (deep mode)</div>
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-muted-foreground">
                        <tr className="border-b">
                          <th className="py-2 pr-3">PID</th>
                          <th className="py-2 pr-3">State</th>
                          <th className="py-2 pr-3">Age (ms)</th>
                          <th className="py-2">Query</th>
                        </tr>
                      </thead>
                      <tbody>
                        {status.database.stats.pg.top_queries.map((q, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2 pr-3">{q.pid}</td>
                            <td className="py-2 pr-3">{q.state ?? "—"}</td>
                            <td className="py-2 pr-3">{q.age_ms}</td>
                            <td className="py-2">
                              <div className="max-w-[80ch] truncate" title={q.query_trunc}>
                                {q.query_trunc}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

              {sqlite && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Stat label="journal_mode" value={sqlite.journal_mode ?? "—"} />
                  {sqlite.wal_checkpoint && (
                    <>
                      <Stat label="WAL busy" value={sqlite.wal_checkpoint.busy ?? "—"} />
                      <Stat label="WAL log" value={sqlite.wal_checkpoint.log ?? "—"} />
                      <Stat label="WAL checkpointed" value={sqlite.wal_checkpoint.checkpointed ?? "—"} />
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Environment */}
          {!!status.env && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Environment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <details>
                  <summary className="cursor-pointer text-sm">
                    Public vars ({Object.keys(status.env.public ?? {}).length})
                  </summary>
                  <ul className="mt-2 space-y-1 rounded border p-2">
                    {Object.entries(status.env.public ?? {}).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between gap-4">
                        <span className="text-sm">{k}</span>
                        <span className="text-xs break-all">{v}</span>
                      </li>
                    ))}
                  </ul>
                </details>
                <details>
                  <summary className="cursor-pointer text-sm">
                    Masked vars ({Object.keys(status.env.masked ?? {}).length})
                  </summary>
                  <ul className="mt-2 space-y-1 rounded border p-2">
                    {Object.entries(status.env.masked ?? {}).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between gap-4">
                        <span className="text-sm">{k}</span>
                        <span className="text-xs break-all">{String(v)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </CardContent>
            </Card>
          )}

          {/* App counts + Sessions */}
          <Card className="xl:col-span-3">
            <CardHeader className="flex items-center justify-between">
              <CardTitle className="text-lg">
                App & Sessions
                {sessionSummary ? (
                  <span className="ml-2 space-x-2">
                    <Badge variant="outline" className="bg-slate-50 text-slate-700">24h: {sessionSummary.total24h}</Badge>
                    <Badge variant="outline" className="bg-slate-50 text-slate-700">Users: {sessionSummary.uniqUsers24h}</Badge>
                    <Badge variant="outline" className="bg-slate-50 text-slate-700">5m: {sessionSummary.last5m}</Badge>
                    <Badge variant="outline" className="bg-slate-50 text-slate-700">15m: {sessionSummary.last15m}</Badge>
                    <Badge variant="outline" className="bg-slate-50 text-slate-700">60m: {sessionSummary.last60m}</Badge>
                  </span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* App counts */}
              {status.app && Object.keys(status.app).length > 0 && (
                <div>
                  <div className="mb-2 text-sm text-muted-foreground">App entity counts</div>
                  <ul className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                    {Object.entries(status.app).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between rounded border p-2 text-sm">
                        <span className="truncate">{k}</span>
                        <span>{String(v)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Active Sessions */}
              {(status.activeSessions?.length ?? 0) > 0 ? (
                <div className="overflow-x-auto">
                  <div className="mb-2 text-sm text-muted-foreground">
                    Active Sessions ({status.activeSessions!.length})
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
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
                            <div className="font-medium">{s.email ?? s.userId ?? "Unknown"}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2">
                              <span>{s.ipAddress ?? "—"}</span>
                              {s.ipAddress ? (
                                <button
                                  className="text-xs text-muted-foreground underline hover:opacity-80"
                                  onClick={() => copy(s.ipAddress)}
                                >
                                  Copy
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-2 pr-3">{s.lastSeen ? formatDateTimeInTimeZone(s.lastSeen, timezone) : "—"}</td>
                          <td className="py-2">
                            <div className="max-w-[50ch] truncate" title={s.userAgent ?? ""}>
                              {s.userAgent ?? "—"}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-sm">No active sessions found.</div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {!loading && !status && (
        <Card>
          <CardContent className="p-6">No status available</CardContent>
        </Card>
      )}
    </div>
  );
}
