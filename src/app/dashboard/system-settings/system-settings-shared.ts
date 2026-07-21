import {
  clampSessionTimeoutMinutes,
  clampBackupHour,
  clampBackupRetentionDays,
  clampActivityLogRetentionDays,
  DEFAULT_ALLOW_SIGNUP,
  DEFAULT_CLOCK_24_HOUR,
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DEFAULT_LOGIN_MAX_ATTEMPTS,
  DEFAULT_LOGIN_LOCKOUT_MINUTES,
  DEFAULT_BACKUP_ENABLED,
  DEFAULT_BACKUP_HOUR,
  DEFAULT_BACKUP_RETENTION_DAYS,
  DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
  DEFAULT_SYSTEM_TIMEZONE,
  DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS,
  DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB,
  DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS,
  DEFAULT_SUBMISSION_MAX_CONCURRENT,
  DEFAULT_SUBMISSION_MAX_ATTEMPTS,
  DEFAULT_SUBMISSION_ANALYZER_LIMIT,
} from '@/lib/system-settings';

export type SystemSettingsResponse = {
  // Read-only NEXTAUTH_URL (server-level), shown for reference; not part of the form.
  configuredUrl: string;
  timezone: string;
  maxUploadSizeMb: number;
  allowSignup: boolean;
  signupAllowedDomains: string;
  clock24Hour: boolean;
  sessionTimeoutMinutes: number;
  submissionEvalTimeoutMs: number;
  submissionEvalMaxMemoryMb: number;
  submissionResubmitCooldownMs: number;
  submissionMaxConcurrent: number;
  submissionMaxAttempts: number;
  submissionAnalyzerLimit: number;
  loginMaxAttempts: number;
  loginLockoutMinutes: number;
  backupEnabled: boolean;
  backupHour: number;
  backupRetentionDays: number;
  activityLogRetentionDays: number;
  hcaptchaSiteKey: string;
  hcaptchaSecretConfigured: boolean;
};

// Fields covered by the main Save (used for unsaved-changes tracking).
export type FormSnapshot = {
  timezone: string;
  maxUploadSizeMb: number | '';
  allowSignup: boolean;
  signupAllowedDomains: string;
  clock24Hour: boolean;
  sessionTimeoutMinutes: number | '';
  evalTimeoutSec: number | '';
  resubmitCooldownSec: number | '';
  evalMaxMemoryMb: number | '';
  maxConcurrent: number | '';
  maxAttempts: number | '';
  analyzerLimit: number | '';
  loginMaxAttempts: number | '';
  loginLockoutMinutes: number | '';
  backupEnabled: boolean;
  backupHour: number | '';
  backupRetentionDays: number | '';
  activityLogRetentionDays: number | '';
  hcaptchaSiteKey: string;
};

/** Typed single-field updater the field JSX calls. */
export type SetField = <K extends keyof FormSnapshot>(field: K, value: FormSnapshot[K]) => void;

export const msToSec = (ms: number) => Math.round(ms / 1000);
export const secToMs = (sec: number) => Math.round(sec * 1000);

export const formatBytes = (n: number | null) => {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
};

// Turn the backup filename timestamp (YYYYMMDD-HHMMSS) into a readable date.
export const formatBackupTs = (ts: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(ts);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : ts;
};

// Human labels for the updater's machine phase strings, both for display and so
// the status live region doesn't announce "rolled underscore back".
const UPGRADE_PHASE_LABELS: Record<string, string> = {
  backing_up: 'Backing up',
  pulling: 'Downloading',
  migrating: 'Migrating',
  stopping: 'Stopping',
  restoring: 'Restoring',
  rolling_back: 'Rolling back',
  rolled_back: 'Rolled back',
  healthy: 'Healthy',
  failed: 'Failed',
};
export const upgradePhaseLabel = (phase: string) =>
  UPGRADE_PHASE_LABELS[phase] ?? phase.replace(/_/g, ' ');

// A single step in the visual upgrade/downgrade progress checklist.
export type UpgradeStepState = 'done' | 'current' | 'pending';
export type UpgradeStep = { label: string; state: UpgradeStepState };

// The ordered steps each flow moves through. The updater reports one coarse phase at a
// time (status.json), which we map onto these so the admin sees where things are.
const UPGRADE_FLOW: { phase: string; label: string }[] = [
  { phase: 'backing_up', label: 'Back up the database' },
  { phase: 'pulling', label: 'Download the new version' },
  { phase: 'migrating', label: 'Restart and migrate' },
  { phase: 'healthy', label: 'Health check' },
];
const DOWNGRADE_FLOW: { phase: string; label: string }[] = [
  { phase: 'backing_up', label: 'Back up current state' },
  { phase: 'stopping', label: 'Stop the application' },
  { phase: 'restoring', label: 'Restore the database' },
  { phase: 'pulling', label: 'Start the previous version' },
  { phase: 'healthy', label: 'Health check' },
];

/**
 * Turn the updater's current phase into an ordered checklist with each step marked
 * done / current / pending. Returns null for phases where a step list doesn't apply
 * (failed / rolled_back / unknown) — those are conveyed by the status badge instead.
 * `action` disambiguates the two flows that share early phases; when it's absent (e.g.
 * after a reload mid-run) the downgrade-only phases still route to the downgrade flow.
 */
export function deriveUpgradeSteps(
  phase: string | undefined | null,
  action?: 'upgrade' | 'downgrade',
): UpgradeStep[] | null {
  if (!phase) return null;
  const isDowngrade = action === 'downgrade' || phase === 'stopping' || phase === 'restoring';
  const flow = isDowngrade ? DOWNGRADE_FLOW : UPGRADE_FLOW;
  const idx = flow.findIndex((s) => s.phase === phase);
  if (idx === -1) return null;
  return flow.map((s, i) => ({
    label: s.label,
    state: phase === 'healthy' ? 'done' : i < idx ? 'done' : i === idx ? 'current' : 'pending',
  }));
}

export const SETTINGS_TAB_KEY = 'afct.systemSettingsTab';
export const SETTINGS_TABS = ['general', 'queue', 'backups', 'captcha', 'tls', 'updates'];

// Normalize a raw settings response into the editable form snapshot (defaults,
// clamping, ms→sec conversions). Shared so the form can be seeded both
// synchronously from a warm cache and via the effect on a cold load.
export function buildSettingsSnapshot(data: SystemSettingsResponse): FormSnapshot {
  return {
    timezone: data.timezone || DEFAULT_SYSTEM_TIMEZONE,
    maxUploadSizeMb: Number(data.maxUploadSizeMb) || DEFAULT_MAX_UPLOAD_SIZE_MB,
    allowSignup: data.allowSignup ?? DEFAULT_ALLOW_SIGNUP,
    signupAllowedDomains: data.signupAllowedDomains ?? '',
    clock24Hour: data.clock24Hour ?? DEFAULT_CLOCK_24_HOUR,
    sessionTimeoutMinutes: clampSessionTimeoutMinutes(
      Number(data.sessionTimeoutMinutes) || DEFAULT_SESSION_TIMEOUT_MINUTES,
    ),
    evalTimeoutSec: msToSec(
      Number(data.submissionEvalTimeoutMs) || DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS,
    ),
    resubmitCooldownSec: msToSec(
      Number(data.submissionResubmitCooldownMs) || DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS,
    ),
    evalMaxMemoryMb:
      Number(data.submissionEvalMaxMemoryMb) || DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB,
    maxConcurrent: Number(data.submissionMaxConcurrent) || DEFAULT_SUBMISSION_MAX_CONCURRENT,
    maxAttempts: Number(data.submissionMaxAttempts) || DEFAULT_SUBMISSION_MAX_ATTEMPTS,
    analyzerLimit: Number(data.submissionAnalyzerLimit) || DEFAULT_SUBMISSION_ANALYZER_LIMIT,
    loginMaxAttempts: Number(data.loginMaxAttempts) || DEFAULT_LOGIN_MAX_ATTEMPTS,
    loginLockoutMinutes: Number(data.loginLockoutMinutes) || DEFAULT_LOGIN_LOCKOUT_MINUTES,
    backupEnabled: data.backupEnabled ?? DEFAULT_BACKUP_ENABLED,
    backupHour: clampBackupHour(Number(data.backupHour) || DEFAULT_BACKUP_HOUR),
    backupRetentionDays: clampBackupRetentionDays(
      Number(data.backupRetentionDays) || DEFAULT_BACKUP_RETENTION_DAYS,
    ),
    activityLogRetentionDays: clampActivityLogRetentionDays(
      Number(data.activityLogRetentionDays) || DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
    ),
    hcaptchaSiteKey: data.hcaptchaSiteKey ?? '',
  };
}

// The Save-covered form is one reducer-managed object. `set` updates a single field;
// `reset` replaces the whole snapshot on seed.
export type FormAction =
  | { type: 'reset'; snapshot: FormSnapshot }
  | {
      [K in keyof FormSnapshot]: { type: 'set'; field: K; value: FormSnapshot[K] };
    }[keyof FormSnapshot];

export function formReducer(state: FormSnapshot, action: FormAction): FormSnapshot {
  if (action.type === 'reset') return action.snapshot;
  return { ...state, [action.field]: action.value };
}

// Cold-start values (before the settings response seeds the form). Field order matches
// buildSettingsSnapshot so the JSON.stringify dirty-check compares like-ordered objects.
export const EMPTY_FORM: FormSnapshot = {
  timezone: '',
  maxUploadSizeMb: '',
  allowSignup: true,
  signupAllowedDomains: '',
  clock24Hour: false,
  sessionTimeoutMinutes: '',
  evalTimeoutSec: '',
  resubmitCooldownSec: '',
  evalMaxMemoryMb: '',
  maxConcurrent: '',
  maxAttempts: '',
  analyzerLimit: '',
  loginMaxAttempts: '',
  loginLockoutMinutes: '',
  backupEnabled: true,
  backupHour: '',
  backupRetentionDays: '',
  activityLogRetentionDays: '',
  hcaptchaSiteKey: '',
};
