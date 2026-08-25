import type { SmtpSecurity } from '@/schemas/smtp';
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
  DEFAULT_SMTP_PORT,
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
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: SmtpSecurity;
  smtpUsername: string;
  smtpPasswordConfigured: boolean;
  smtpFromAddress: string;
  smtpFromName: string;
  oidcEnabled: boolean;
  oidcIssuer: string;
  oidcClientId: string;
  /** Whether this deployment can decrypt the stored secret, not merely that one is stored. */
  oidcClientSecretReadable?: boolean;
  /** The same question for the mail password: a rotated key leaves mail unable to send. */
  smtpPasswordReadable?: boolean;
  oidcClientSecretConfigured: boolean;
  oidcButtonLabel: string;
  oidcTrustEmail: boolean;
  allowLinkedAccountPasswords: boolean;
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
  smtpEnabled: boolean;
  smtpHost: string;
  smtpPort: number | '';
  smtpSecurity: SmtpSecurity;
  smtpUsername: string;
  smtpFromAddress: string;
  smtpFromName: string;
  oidcEnabled: boolean;
  oidcIssuer: string;
  oidcClientId: string;
  oidcButtonLabel: string;
  oidcTrustEmail: boolean;
  allowLinkedAccountPasswords: boolean;
};

/** Typed single-field updater the field JSX calls. */
export type SetField = <K extends keyof FormSnapshot>(field: K, value: FormSnapshot[K]) => void;

export const msToSec = (ms: number) => Math.round(ms / 1000);
export const secToMs = (sec: number) => Math.round(sec * 1000);

// Shared with the status pages; see `lib/format-bytes`.
export { formatBytes } from '@/lib/format-bytes';

// Turn the backup filename timestamp (YYYYMMDD-HHMMSS) into a readable date, kept as-is
// (server clock). Used for the tooltip and as the local-time fallback.
export const formatBackupTs = (ts: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(ts);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}` : ts;
};

// Parse a backup filename timestamp into a Date. Backups are written with the server's
// clock, which AFCT runs in UTC (docker/backup/backup.sh, and the "server time (UTC)"
// backup-hour setting), so we read the parts as UTC. Null if the string doesn't match.
export const parseBackupTs = (ts: string): Date | null => {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(ts);
  if (!m) return null;
  return new Date(
    Date.UTC(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
    ),
  );
};

// A backup timestamp in the viewer's own timezone, with the zone shown so it's
// unambiguous (e.g. "Jan 15, 2026, 3:02:01 AM EST"). Falls back to the raw server-time
// string if it can't be parsed.
export const formatBackupTsLocal = (ts: string): string => {
  const d = parseBackupTs(ts);
  if (!d) return formatBackupTs(ts);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
};

// Parse a release tag like "v0.1.19" or "0.1.19" into [major, minor, patch]. Returns
// null for anything that isn't a plain three-part version (e.g. "main" in dev, or a
// commit SHA), so callers can fall back rather than guess an ordering.
export function parseVersionTag(tag: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Whether `tag` is a strictly higher version than `current`. Returns null when either
// side isn't a parseable version, so the caller keeps its old behaviour instead of
// hiding versions it can't compare.
export function isNewerThan(tag: string, current: string): boolean | null {
  const a = parseVersionTag(tag);
  const b = parseVersionTag(current);
  if (!a || !b) return null;
  const [a0, a1, a2] = a;
  const [b0, b1, b2] = b;
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

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

// Whether a failed downgrade failed specifically because the updater could not confirm a
// pre-downgrade safety backup (a refusal it makes BEFORE touching anything, so it is a
// safe state to offer a forced retry from). Keyed off the updater's refusal message in
// docker/updater/updater.sh (process_downgrade), which starts "Could not confirm a
// backup...". If that wording changes, the forced-retry affordance simply stops
// appearing (the admin can still recover from the server), so this degrades gracefully.
export function downgradeRefusedForSafetyBackup(message: string | undefined | null): boolean {
  return !!message && /could not confirm a backup/i.test(message);
}

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

// Ordered steps of a Let's Encrypt issuance (the acme status file's coarse phases).
const ACME_FLOW: { phase: string; label: string }[] = [
  { phase: 'requesting', label: 'Contact Let’s Encrypt' },
  { phase: 'validating', label: 'Validate domain ownership' },
  { phase: 'installing', label: 'Install the certificate' },
];

/**
 * Turn an ACME issuance phase into the ordered checklist. `starting` collapses into the
 * first step; `done` marks everything complete; `error`/`idle`/unknown return null (the
 * failure is shown as a toast/message instead).
 */
export function deriveAcmeSteps(phase: string | undefined | null): UpgradeStep[] | null {
  if (!phase) return null;
  if (phase === 'done') return ACME_FLOW.map((s) => ({ label: s.label, state: 'done' }));
  const p = phase === 'starting' ? 'requesting' : phase;
  const idx = ACME_FLOW.findIndex((s) => s.phase === p);
  if (idx === -1) return null;
  return ACME_FLOW.map((s, i) => ({
    label: s.label,
    state: i < idx ? 'done' : i === idx ? 'current' : 'pending',
  }));
}

/**
 * Field names as they appear on screen, for error messages.
 *
 * This page has around thirty fields across seven tabs, and a validation failure used to
 * surface as the bare Zod message ("Invalid email address") with nothing saying which field
 * or which tab. That is unusable: the person reading it is a professor looking at a wall of
 * settings. Anything not listed falls back to its key, which is still better than nothing.
 */
const SETTINGS_FIELD_LABELS: Record<string, string> = {
  timezone: 'Timezone',
  maxUploadSizeMb: 'Maximum upload size',
  signupAllowedDomains: 'Allowed signup domains',
  sessionTimeoutMinutes: 'Session timeout',
  submissionEvalTimeoutMs: 'Evaluation timeout',
  submissionEvalMaxMemoryMb: 'Evaluator memory limit',
  submissionResubmitCooldownMs: 'Resubmit cooldown',
  submissionMaxConcurrent: 'Concurrent evaluations',
  submissionMaxAttempts: 'Evaluation attempts',
  submissionAnalyzerLimit: 'Analyzer limit',
  loginMaxAttempts: 'Failed sign-in attempts',
  loginLockoutMinutes: 'Lockout duration',
  backupHour: 'Backup hour',
  backupRetentionDays: 'Backup retention',
  activityLogRetentionDays: 'Activity log retention',
  hcaptchaSiteKey: 'hCaptcha site key',
  hcaptchaSecretKey: 'hCaptcha secret key',
  smtpHost: 'Mail server',
  smtpPort: 'Port',
  smtpSecurity: 'Encryption',
  smtpUsername: 'Username',
  smtpPassword: 'Password',
  smtpFromAddress: 'From address',
  smtpFromName: 'From name',
  oidcIssuer: 'Issuer URL',
  oidcClientId: 'Client ID',
  oidcClientSecret: 'Client secret',
  oidcButtonLabel: 'Button wording',
};

/** "From address: Enter an address like afct@your-university.edu." */
export function describeSettingsIssue(issue: { path: PropertyKey[]; message: string }): string {
  const key = String(issue.path[0] ?? '');
  const label = SETTINGS_FIELD_LABELS[key] ?? key;
  return label ? `${label}: ${issue.message}` : issue.message;
}

export const SETTINGS_TAB_KEY = 'afct.systemSettingsTab';
export const SETTINGS_TABS = [
  'general',
  'queue',
  'backups',
  'email',
  'sign-in',
  'captcha',
  'tls',
  'updates',
];

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
    smtpEnabled: data.smtpEnabled ?? false,
    smtpHost: data.smtpHost ?? '',
    smtpPort: data.smtpPort ?? DEFAULT_SMTP_PORT,
    smtpSecurity: data.smtpSecurity ?? 'STARTTLS',
    smtpUsername: data.smtpUsername ?? '',
    smtpFromAddress: data.smtpFromAddress ?? '',
    smtpFromName: data.smtpFromName ?? '',
    oidcEnabled: data.oidcEnabled ?? false,
    oidcIssuer: data.oidcIssuer ?? '',
    oidcClientId: data.oidcClientId ?? '',
    oidcButtonLabel: data.oidcButtonLabel ?? '',
    oidcTrustEmail: data.oidcTrustEmail ?? false,
    // Default true, matching the server: a missing value is an older payload, not a policy.
    allowLinkedAccountPasswords: data.allowLinkedAccountPasswords ?? true,
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
  smtpEnabled: false,
  smtpHost: '',
  smtpPort: DEFAULT_SMTP_PORT,
  smtpSecurity: 'STARTTLS',
  smtpUsername: '',
  smtpFromAddress: '',
  smtpFromName: '',
  oidcEnabled: false,
  oidcIssuer: '',
  oidcClientId: '',
  oidcButtonLabel: '',
  oidcTrustEmail: false,
  allowLinkedAccountPasswords: true,
};

/**
 * The outlined box each settings tab groups its fields in.
 *
 * One constant rather than a class repeated per tab: the tabs are meant to look like one
 * screen with sections, and the quickest way to lose that is for each to drift on its own.
 */
/*
 * One settings panel.
 *
 * rounded-lg with shadow-xs, matching the Settings Menu rail beside it and `ui/card`: the
 * panels were rounded-md and flat, so the rail read as the more finished object of the two
 * even though the form is the page. Full-strength border, deliberately: a fainter one is
 * the first thing to disappear in the high-contrast theme, where the boundary is the only
 * thing separating a panel from the page.
 */
export const SETTINGS_BOX_CLASS = 'space-y-5 rounded-lg border p-4 shadow-xs';
