/**
 * Shared types for the admin System Status feature, used by both the server
 * collectors (`src/lib/status/*`) and the client tab components so the API
 * contract lives in one place. Each per-domain route returns the matching
 * `*StatusResponse` slice; the summary route returns `SummaryStatus`.
 */

/* ---------------- Server ---------------- */
export type IpAddr = { iface?: string; address?: string; family?: string };
export type CpuInfo = { model?: string; speed?: number };

export type SystemStats = {
  pid?: number;
  cwd?: string;
  tz?: string;
  memProcess?: Record<string, number>;
  memProcessPctOfSystem?: number;
  cpuProcessPct?: number;
  diskIo?: { device?: string; readBytesPerSec?: number; writeBytesPerSec?: number };
  uptimeBreakdown?: { days: number; hours: number; minutes: number; seconds: number };
};

export type SystemBlock = {
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

/** Version + build metadata shown on the Server tab's Software section. */
export type SoftwareBlock = {
  nodeVersion?: string;
  nextVersion?: string;
  javaVersion?: string;
  evaluatorVersion?: string;
  deployEnv?: string;
  buildHash?: string;
  imageTag?: string;
};

export type ServerStatusResponse = {
  system: SystemBlock;
  software: SoftwareBlock;
};

/* ---------------- Database ---------------- */
export type DatabaseDetails = {
  version?: string;
  sqlite_version?: string;
  current_database?: string;
  current_time_iso?: string;
  search_path?: string;
  visible_schemas?: string[];
  table_count?: number;
  table_count_visible?: number | null;
  table_count_all?: number | null;
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

export type PgStats = {
  max_connections?: number | null;
  num_backends?: number | null;
  connections_by_state?: Record<string, number>;
  connections_idle_in_xact?: number | null;
  db_size_mb?: number | null;
  cache_hit_ratio?: number | null;
  seq_scans?: number | null;
  idx_scans?: number | null;
  transactions_per_sec?: number | null;
  slow_query_count?: number | null;
};

export type SqliteStats = {
  journal_mode?: string | null;
  wal_checkpoint?: {
    busy?: number | null;
    log?: number | null;
    checkpointed?: number | null;
  } | null;
};

export type DatabaseStats = { pg?: PgStats; sqlite?: SqliteStats };

export type DatabaseStatusResponse = {
  ok: boolean;
  message: string;
  provider: 'sqlite' | 'postgres' | 'unknown';
  /** Round-trip latency of a `SELECT 1` probe, ms. */
  latencyMs: number | null;
  details?: DatabaseDetails;
  stats?: DatabaseStats;
};

/* ---------------- Docker ---------------- */
export type DockerInfo = {
  isDocker: boolean;
  containerId?: string;
  containerIdShort?: string;
  hostname?: string;
  envHostname?: string;
  indicators?: string[];
  cgroupPaths?: string[];
  // The image tag / version this container is running (matches the Updates tab).
  imageTag?: string;
  cgroupVersion?: 'v1' | 'v2';
  // Container resource caps read from cgroup. A finite number is the cap
  // (bytes / CPU cores); `null` means explicitly unlimited; `undefined` means it
  // could not be read.
  memoryLimitBytes?: number | null;
  cpuLimit?: number | null;
};

export type DockerStatusResponse = { docker: DockerInfo | null };

/* ---------------- Network ---------------- */
export type NetworkStatusResponse = {
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

/* ---------------- Sessions ---------------- */
export type SessionItem = {
  userId?: string | null;
  email?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  lastSeen?: string | null;
};

export type SessionSummary = {
  total24h: number;
  uniqUsers24h: number;
  last5m: number;
  last15m: number;
  last60m: number;
};

export type SessionsStatusResponse = {
  activeSessions: SessionItem[];
  summary: SessionSummary;
};

/* ---------------- Files ---------------- */
export type AbandonedFileCategory = 'solutions' | 'submissions' | 'pfps' | 'problems';

export type AbandonedFilesSummary = {
  total: number;
  byCategory: Record<string, number>;
  samples: Array<{ category: string; fileName: string; path: string }>;
};

export type FilesStatusResponse = { abandonedFiles: AbandonedFilesSummary };

/* ---------------- Summary (top cards) ---------------- */
export type SummaryStatus = {
  db: { ok: boolean; message: string; provider: 'sqlite' | 'postgres' | 'unknown' };
  uptime?: number;
  procCpuPct?: number;
  procMemPct?: number;
  dbTables?: number | null;
  dbSizeBytes?: number | null;
  sessions24h?: number;
  uniqueUsers24h?: number;
  /** End-to-end latency of the summary probe, ms. */
  latencyMs?: number;
};
