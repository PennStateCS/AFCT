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
