export const DEFAULT_SYSTEM_TIMEZONE = 'UTC';
export const DEFAULT_MAX_UPLOAD_SIZE_MB = 25;
export const MIN_UPLOAD_SIZE_MB = 1;
export const MAX_UPLOAD_SIZE_MB = 1024;
export const DEFAULT_ALLOW_SIGNUP = true;
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 20;
export const MIN_SESSION_TIMEOUT_MINUTES = 5;
export const MAX_SESSION_TIMEOUT_MINUTES = 1440;

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

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

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
