import { clampInt } from '@/lib/api/request';

export const DEFAULT_SYSTEM_TIMEZONE = 'UTC';
export const DEFAULT_MAX_UPLOAD_SIZE_MB = 25;
export const MIN_UPLOAD_SIZE_MB = 1;
// Ceiling for the admin-configurable per-file upload limit. Must stay <= nginx's
// client_max_body_size (docker/nginx/default.conf) so the infra rejects oversized
// bodies before they reach the app. Generous for this app (submissions are KB,
// avatars a few MB); the old 1024 let a single request stream ~1 GB into memory.
export const MAX_UPLOAD_SIZE_MB = 50;
export const DEFAULT_ALLOW_SIGNUP = true;
/** Canonical comma-separated signup email-domain allow-list. Blank = any domain allowed. */
export const DEFAULT_SIGNUP_ALLOWED_DOMAINS = '';
/** App-wide clock: false = 12-hour (AM/PM), true = 24-hour. Display-only. */
export const DEFAULT_CLOCK_24_HOUR = false;
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 60;
export const MIN_SESSION_TIMEOUT_MINUTES = 5;
export const MAX_SESSION_TIMEOUT_MINUTES = 1440;

// Login lockout policy (per-account). Bounds keep it from being set so loose
// that brute-force protection is effectively disabled.
export const DEFAULT_LOGIN_MAX_ATTEMPTS = 10;
export const MIN_LOGIN_MAX_ATTEMPTS = 3;
export const MAX_LOGIN_MAX_ATTEMPTS = 50;
export const DEFAULT_LOGIN_LOCKOUT_MINUTES = 10;
export const MIN_LOGIN_LOCKOUT_MINUTES = 1;
export const MAX_LOGIN_LOCKOUT_MINUTES = 1440;

// Database backups. backupHour is a 24-hour clock hour in server (UTC) time;
// retention bounds keep dumps from being kept forever or pruned too aggressively.
export const DEFAULT_BACKUP_ENABLED = true;
export const DEFAULT_BACKUP_HOUR = 2;
export const MIN_BACKUP_HOUR = 0;
export const MAX_BACKUP_HOUR = 23;
export const DEFAULT_BACKUP_RETENTION_DAYS = 14;
export const MIN_BACKUP_RETENTION_DAYS = 1;
export const MAX_BACKUP_RETENTION_DAYS = 365;

// Audit-log retention. Kept from getting so short that the trail is useless, or
// so long the table grows without bound.
export const DEFAULT_ACTIVITY_LOG_RETENTION_DAYS = 365;
export const MIN_ACTIVITY_LOG_RETENTION_DAYS = 30;
export const MAX_ACTIVITY_LOG_RETENTION_DAYS = 3650;

export function clampSessionTimeoutMinutes(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_SESSION_TIMEOUT_MINUTES;
  }

  return Math.max(
    MIN_SESSION_TIMEOUT_MINUTES,
    Math.min(MAX_SESSION_TIMEOUT_MINUTES, Math.trunc(value)),
  );
}

export function clampUploadSizeMb(maxMb: number): number {
  if (!Number.isFinite(maxMb)) {
    return DEFAULT_MAX_UPLOAD_SIZE_MB;
  }
  return Math.max(MIN_UPLOAD_SIZE_MB, Math.min(MAX_UPLOAD_SIZE_MB, Math.trunc(maxMb)));
}

/* ---------------- Submission queue ---------------- */
// Time values are kept in milliseconds to match the worker/route code; the UI
// presents the two duration fields in seconds.

export const DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS = 30_000;
export const MIN_SUBMISSION_EVAL_TIMEOUT_MS = 1_000;
export const MAX_SUBMISSION_EVAL_TIMEOUT_MS = 600_000;

export const DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB = 256;
export const MIN_SUBMISSION_EVAL_MAX_MEMORY_MB = 64;
export const MAX_SUBMISSION_EVAL_MAX_MEMORY_MB = 8_192;

export const DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS = 10_000;
export const MIN_SUBMISSION_RESUBMIT_COOLDOWN_MS = 0;
export const MAX_SUBMISSION_RESUBMIT_COOLDOWN_MS = 3_600_000;

export const DEFAULT_SUBMISSION_MAX_CONCURRENT = 5;
export const MIN_SUBMISSION_MAX_CONCURRENT = 1;
export const MAX_SUBMISSION_MAX_CONCURRENT = 20;

export const DEFAULT_SUBMISSION_MAX_ATTEMPTS = 3;
export const MIN_SUBMISSION_MAX_ATTEMPTS = 1;
export const MAX_SUBMISSION_MAX_ATTEMPTS = 10;

// cfganalyzer exploration bound (CFGANALYZER_LIMIT). Higher = deeper checks but
// slower; the eval timeout still guards runaway cases.
export const DEFAULT_SUBMISSION_ANALYZER_LIMIT = 15;
export const MIN_SUBMISSION_ANALYZER_LIMIT = 1;
export const MAX_SUBMISSION_ANALYZER_LIMIT = 100;

export const clampSubmissionEvalTimeoutMs = (v: number) =>
  clampInt(v, MIN_SUBMISSION_EVAL_TIMEOUT_MS, MAX_SUBMISSION_EVAL_TIMEOUT_MS, DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS);

export const clampSubmissionEvalMaxMemoryMb = (v: number) =>
  clampInt(v, MIN_SUBMISSION_EVAL_MAX_MEMORY_MB, MAX_SUBMISSION_EVAL_MAX_MEMORY_MB, DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB);

export const clampSubmissionResubmitCooldownMs = (v: number) =>
  clampInt(v, MIN_SUBMISSION_RESUBMIT_COOLDOWN_MS, MAX_SUBMISSION_RESUBMIT_COOLDOWN_MS, DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS);

export const clampSubmissionMaxConcurrent = (v: number) =>
  clampInt(v, MIN_SUBMISSION_MAX_CONCURRENT, MAX_SUBMISSION_MAX_CONCURRENT, DEFAULT_SUBMISSION_MAX_CONCURRENT);

export const clampSubmissionMaxAttempts = (v: number) =>
  clampInt(v, MIN_SUBMISSION_MAX_ATTEMPTS, MAX_SUBMISSION_MAX_ATTEMPTS, DEFAULT_SUBMISSION_MAX_ATTEMPTS);

export const clampSubmissionAnalyzerLimit = (v: number) =>
  clampInt(v, MIN_SUBMISSION_ANALYZER_LIMIT, MAX_SUBMISSION_ANALYZER_LIMIT, DEFAULT_SUBMISSION_ANALYZER_LIMIT);

export const clampLoginMaxAttempts = (v: number) =>
  clampInt(v, MIN_LOGIN_MAX_ATTEMPTS, MAX_LOGIN_MAX_ATTEMPTS, DEFAULT_LOGIN_MAX_ATTEMPTS);

export const clampLoginLockoutMinutes = (v: number) =>
  clampInt(v, MIN_LOGIN_LOCKOUT_MINUTES, MAX_LOGIN_LOCKOUT_MINUTES, DEFAULT_LOGIN_LOCKOUT_MINUTES);

export const clampBackupHour = (v: number) =>
  clampInt(v, MIN_BACKUP_HOUR, MAX_BACKUP_HOUR, DEFAULT_BACKUP_HOUR);

export const clampBackupRetentionDays = (v: number) =>
  clampInt(v, MIN_BACKUP_RETENTION_DAYS, MAX_BACKUP_RETENTION_DAYS, DEFAULT_BACKUP_RETENTION_DAYS);

export const clampActivityLogRetentionDays = (v: number) =>
  clampInt(
    v,
    MIN_ACTIVITY_LOG_RETENTION_DAYS,
    MAX_ACTIVITY_LOG_RETENTION_DAYS,
    DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
  );
