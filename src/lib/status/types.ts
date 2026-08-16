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

/** One uploaded file that no database row points at. */
export type AbandonedFile = {
  category: string;
  fileName: string;
  path: string;
  sizeBytes: number;
  /** When the file was last written, ISO 8601. */
  modifiedAt: string;
};

/** One upload directory's worth of the report. */
export type AbandonedFileCategory = {
  category: string;
  /** Plain-language name for the screen, not the folder name. */
  label: string;
  count: number;
  sizeBytes: number;
  /** Set when the folder could not be read, in which case the count is not a fact. */
  error?: string;
};

export type AbandonedFilesSummary = {
  total: number;
  totalSizeBytes: number;
  categories: AbandonedFileCategory[];
  /** The files themselves, capped at `listLimit`. Counts above are always complete. */
  files: AbandonedFile[];
  listLimit: number;
  /**
   * Set when the report could not be produced at all. Callers must not read the zeroes above
   * as "nothing to clean up" while this is present: a failed check and a clean volume are
   * different answers and used to be indistinguishable.
   */
  error?: string;
};

export type FilesStatusResponse = { abandonedFiles: AbandonedFilesSummary };

/* ---------------- Rate limits ---------------- */
/**
 * The rate-limiter scopes keyed on a client IP address. Scopes keyed on an email or a
 * user id are never surfaced here, so this tab only ever shows addresses.
 */
export type RateLimitScope = 'login:ip' | 'signup:ip' | 'check-email:ip';

/** A hard block, or the softer captcha-challenge cooldown that precedes one. */
export type RateLimitState = 'blocked' | 'challenge';

export type RateLimitEntry = {
  /** Opaque handle (the rate limiter's bucket key) so one entry can be round-tripped. */
  id: string;
  ip: string;
  scope: RateLimitScope;
  /** Short name of the limit that fired, e.g. "Sign-in attempts". */
  scopeLabel: string;
  state: RateLimitState;
  /** Plain-language explanation for the administrator. */
  reason: string;
  /** Epoch ms when the current restriction was applied. */
  startedAt: number;
  /** Epoch ms when it lifts on its own. */
  expiresAt: number;
  /** Attempts counted in the current window before the restriction applied. */
  attempts: number;
  /** Attempts refused since the restriction applied (is it still knocking?). */
  attemptsWhileRestricted: number;
  /** Epoch ms of the most recent attempt, refused or not. */
  lastAttemptAt: number;
};

/** Where an address sits in the address space, which is decided without any lookup. */
export type IpKind = 'public' | 'private' | 'loopback' | 'link-local' | 'shared' | 'unknown';

/** How the reverse-DNS lookup went, so the UI can say "no name" rather than stay blank. */
export type HostnameLookup = 'ok' | 'none' | 'skipped' | 'failed';

/**
 * What AFCT already knows about an address from its own activity log: whether it is a
 * familiar address and roughly how busy. This is the signal that separates "the computer
 * lab" from "somewhere that has never been seen before".
 */
export type IpKnownActivity = {
  /** Days of log searched. */
  windowDays: number;
  eventCount: number;
  accountCount: number;
  /** A small sample of the accounts seen, for recognising a shared address. */
  accounts: string[];
  firstSeen: number | null;
  lastSeen: number | null;
  /** True when the scan cap was hit, so the counts are a floor rather than a total. */
  truncated: boolean;
};

export type IpDetails = {
  version: 4 | 6 | null;
  kind: IpKind;
  /** Plain-language form of `kind`, e.g. "Private network address". */
  kindLabel: string;
  hostname: string | null;
  hostnameLookup: HostnameLookup;
  /** Null when the activity-log lookup could not run. */
  knownActivity: IpKnownActivity | null;
};

/** A restricted address plus everything that could be worked out about it. */
export type RateLimitedAddress = RateLimitEntry & { details: IpDetails };

export type RateLimitsStatusResponse = {
  entries: RateLimitedAddress[];
  /** Epoch ms the list was taken, so the client can render "expires in" without clock skew. */
  generatedAt: number;
};

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
