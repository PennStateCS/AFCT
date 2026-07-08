import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { isAdmin } from '@/lib/permissions';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import {
  createEnhancedActivityLog,
  type EnhancedActivityLogData,
} from '@/lib/activity-log-utils';
import {
  clampSessionTimeoutMinutes,
  clampSubmissionEvalTimeoutMs,
  clampSubmissionEvalMaxMemoryMb,
  clampSubmissionResubmitCooldownMs,
  clampSubmissionMaxConcurrent,
  clampSubmissionMaxAttempts,
  clampSubmissionAnalyzerLimit,
  clampLoginMaxAttempts,
  clampLoginLockoutMinutes,
  clampBackupHour,
  clampBackupRetentionDays,
  clampActivityLogRetentionDays,
  DEFAULT_LOGIN_MAX_ATTEMPTS,
  DEFAULT_LOGIN_LOCKOUT_MINUTES,
  DEFAULT_BACKUP_ENABLED,
  DEFAULT_BACKUP_HOUR,
  DEFAULT_BACKUP_RETENTION_DAYS,
  DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
  DEFAULT_ALLOW_SIGNUP,
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS,
  DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB,
  DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS,
  DEFAULT_SUBMISSION_MAX_CONCURRENT,
  DEFAULT_SUBMISSION_MAX_ATTEMPTS,
  DEFAULT_SUBMISSION_ANALYZER_LIMIT,
  DEFAULT_SYSTEM_TIMEZONE,
} from '@/lib/system-settings';

// Settings whose changes are safe to record verbatim in the audit log. The
// hCaptcha secret is deliberately excluded — we only log whether it was
// set/cleared, never its value.
const AUDITED_FIELDS = [
  'timezone',
  'maxUploadSizeMb',
  'allowSignup',
  'sessionTimeoutMinutes',
  'submissionEvalTimeoutMs',
  'submissionEvalMaxMemoryMb',
  'submissionResubmitCooldownMs',
  'submissionMaxConcurrent',
  'submissionMaxAttempts',
  'submissionAnalyzerLimit',
  'loginMaxAttempts',
  'loginLockoutMinutes',
  'backupEnabled',
  'backupHour',
  'backupRetentionDays',
  'activityLogRetentionDays',
  'hcaptchaSiteKey',
] as const;

// The audited fields hold only JSON primitives (strings, numbers, booleans).
type JsonPrimitive = string | number | boolean | null;

// Build a { field: { from, to } } diff of the audited fields. A null `before`
// (first-time create) reports every field as newly set.
function diffSettings(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Record<string, { from: JsonPrimitive; to: JsonPrimitive }> {
  const changes: Record<string, { from: JsonPrimitive; to: JsonPrimitive }> = {};
  for (const field of AUDITED_FIELDS) {
    const from = (before ? (before[field] ?? null) : null) as JsonPrimitive;
    const to = (after[field] ?? null) as JsonPrimitive;
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
}

// Audit logging must never turn a successful save into a 500, so swallow its errors.
async function safeAuditLog(req: Request, data: EnhancedActivityLogData): Promise<void> {
  try {
    await createEnhancedActivityLog(prisma, req, data);
  } catch (err) {
    console.error('[system-settings] audit log failed:', err);
  }
}

/**
 * Returns the singleton system settings, falling back to defaults for any unset
 * field. The hCaptcha secret is never returned — only `hcaptchaSecretConfigured`
 * reports whether one is stored. System administrators only.
 * @openapi
 * summary: Get system settings
 * responses:
 *   200:
 *     description: The effective system settings.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             timezone: { type: string }
 *             maxUploadSizeMb: { type: integer }
 *             allowSignup: { type: boolean }
 *             sessionTimeoutMinutes: { type: integer }
 *             submissionEvalTimeoutMs: { type: integer }
 *             submissionEvalMaxMemoryMb: { type: integer }
 *             submissionResubmitCooldownMs: { type: integer }
 *             submissionMaxConcurrent: { type: integer }
 *             submissionMaxAttempts: { type: integer }
 *             submissionAnalyzerLimit: { type: integer }
 *             loginMaxAttempts: { type: integer }
 *             loginLockoutMinutes: { type: integer }
 *             backupEnabled: { type: boolean }
 *             backupHour: { type: integer, description: Hour of day (0-23) the daily backup runs }
 *             backupRetentionDays: { type: integer }
 *             activityLogRetentionDays: { type: integer }
 *             hcaptchaSiteKey: { type: string }
 *             hcaptchaSecretConfigured: { type: boolean, description: Whether a secret is stored; the value is never returned }
 *   403: { description: Caller is not a system administrator. }
 */
export async function GET() {
  const session = await auth();
  if (!isAdmin(session?.user)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return NextResponse.json({
    timezone: settings?.timezone ?? DEFAULT_SYSTEM_TIMEZONE,
    maxUploadSizeMb: settings?.maxUploadSizeMb ?? DEFAULT_MAX_UPLOAD_SIZE_MB,
    allowSignup: settings?.allowSignup ?? DEFAULT_ALLOW_SIGNUP,
    sessionTimeoutMinutes: settings?.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
    submissionEvalTimeoutMs:
      settings?.submissionEvalTimeoutMs ?? DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS,
    submissionEvalMaxMemoryMb:
      settings?.submissionEvalMaxMemoryMb ?? DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB,
    submissionResubmitCooldownMs:
      settings?.submissionResubmitCooldownMs ?? DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS,
    submissionMaxConcurrent:
      settings?.submissionMaxConcurrent ?? DEFAULT_SUBMISSION_MAX_CONCURRENT,
    submissionMaxAttempts:
      settings?.submissionMaxAttempts ?? DEFAULT_SUBMISSION_MAX_ATTEMPTS,
    submissionAnalyzerLimit:
      settings?.submissionAnalyzerLimit ?? DEFAULT_SUBMISSION_ANALYZER_LIMIT,
    loginMaxAttempts: settings?.loginMaxAttempts ?? DEFAULT_LOGIN_MAX_ATTEMPTS,
    loginLockoutMinutes: settings?.loginLockoutMinutes ?? DEFAULT_LOGIN_LOCKOUT_MINUTES,
    backupEnabled: settings?.backupEnabled ?? DEFAULT_BACKUP_ENABLED,
    backupHour: settings?.backupHour ?? DEFAULT_BACKUP_HOUR,
    backupRetentionDays: settings?.backupRetentionDays ?? DEFAULT_BACKUP_RETENTION_DAYS,
    activityLogRetentionDays:
      settings?.activityLogRetentionDays ?? DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
    // Public site key is returned; the secret is never sent, only whether it's set.
    hcaptchaSiteKey: settings?.hcaptchaSiteKey ?? '',
    hcaptchaSecretConfigured: Boolean(settings?.hcaptchaSecretKey),
  });
}

type SettingsBody = {
  timezone?: string;
  maxUploadSizeMb?: number;
  allowSignup?: boolean;
  sessionTimeoutMinutes?: number;
  submissionEvalTimeoutMs?: number;
  submissionEvalMaxMemoryMb?: number;
  submissionResubmitCooldownMs?: number;
  submissionMaxConcurrent?: number;
  submissionMaxAttempts?: number;
  submissionAnalyzerLimit?: number;
  loginMaxAttempts?: number;
  loginLockoutMinutes?: number;
  backupEnabled?: boolean;
  backupHour?: number;
  backupRetentionDays?: number;
  activityLogRetentionDays?: number;
  hcaptchaSiteKey?: string;
  hcaptchaSecretKey?: string;
  hcaptchaSecretClear?: boolean;
};

/**
 * Updates the singleton system settings (upsert). Every field is optional, so a
 * partial payload only touches the fields it includes; numeric fields are clamped
 * to safe bounds and an invalid timezone is rejected. The hCaptcha secret is
 * write-only: send a non-empty `hcaptchaSecretKey` to set it, or
 * `hcaptchaSecretClear: true` to remove it. Changes are audited (never the secret
 * value). System administrators only.
 * @openapi
 * summary: Update system settings
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           timezone: { type: string }
 *           maxUploadSizeMb: { type: integer }
 *           allowSignup: { type: boolean }
 *           sessionTimeoutMinutes: { type: integer }
 *           submissionEvalTimeoutMs: { type: integer }
 *           submissionEvalMaxMemoryMb: { type: integer }
 *           submissionResubmitCooldownMs: { type: integer }
 *           submissionMaxConcurrent: { type: integer }
 *           submissionMaxAttempts: { type: integer }
 *           submissionAnalyzerLimit: { type: integer }
 *           loginMaxAttempts: { type: integer }
 *           loginLockoutMinutes: { type: integer }
 *           backupEnabled: { type: boolean }
 *           backupHour: { type: integer }
 *           backupRetentionDays: { type: integer }
 *           activityLogRetentionDays: { type: integer }
 *           hcaptchaSiteKey: { type: string }
 *           hcaptchaSecretKey: { type: string, description: Write-only; a non-empty value sets the secret }
 *           hcaptchaSecretClear: { type: boolean, description: Set true to remove the stored secret }
 * responses:
 *   200: { description: The updated settings (same shape as GET). }
 *   400: { description: Invalid JSON body or invalid timezone. }
 *   403: { description: Caller is not a system administrator (attempt is audited). }
 *   500: { description: Failed to persist the update. }
 */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user || !isAdmin(session.user)) {
    // Record write attempts from a signed-in user who lacks permission — a
    // privilege-escalation probe is worth a trail. Unauthenticated hits are skipped.
    if (session?.user?.id) {
      await safeAuditLog(req, {
        userId: session.user.id,
        action: 'SYSTEM_SETTINGS_UPDATE_DENIED',
        severity: 'SECURITY',
        category: 'SYSTEM',
        metadata: {},
      });
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  let body: SettingsBody;
  try {
    body = (await req.json()) as SettingsBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const timezone = String(body.timezone ?? '').trim();
  const rawSize = Number(body.maxUploadSizeMb);
  const maxUploadSizeMb = Math.max(
    1,
    Math.min(1024, Number.isFinite(rawSize) ? Math.trunc(rawSize) : 0),
  );
  const sessionTimeoutMinutes = clampSessionTimeoutMinutes(Number(body.sessionTimeoutMinutes));
  const hasAllowSignup = typeof body.allowSignup === 'boolean';

  if (!COMMON_TIMEZONES.includes(timezone as (typeof COMMON_TIMEZONES)[number])) {
    return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 });
  }

  // Queue settings are optional in the payload; only persist the ones provided so
  // a partial update can't reset the others.
  const queueData: Record<string, number> = {};
  if (body.submissionEvalTimeoutMs !== undefined)
    queueData.submissionEvalTimeoutMs = clampSubmissionEvalTimeoutMs(Number(body.submissionEvalTimeoutMs));
  if (body.submissionEvalMaxMemoryMb !== undefined)
    queueData.submissionEvalMaxMemoryMb = clampSubmissionEvalMaxMemoryMb(Number(body.submissionEvalMaxMemoryMb));
  if (body.submissionResubmitCooldownMs !== undefined)
    queueData.submissionResubmitCooldownMs = clampSubmissionResubmitCooldownMs(Number(body.submissionResubmitCooldownMs));
  if (body.submissionMaxConcurrent !== undefined)
    queueData.submissionMaxConcurrent = clampSubmissionMaxConcurrent(Number(body.submissionMaxConcurrent));
  if (body.submissionMaxAttempts !== undefined)
    queueData.submissionMaxAttempts = clampSubmissionMaxAttempts(Number(body.submissionMaxAttempts));
  if (body.submissionAnalyzerLimit !== undefined)
    queueData.submissionAnalyzerLimit = clampSubmissionAnalyzerLimit(Number(body.submissionAnalyzerLimit));

  // Login lockout policy — only persist the fields provided, clamped to safe bounds.
  const loginData: Record<string, number> = {};
  if (body.loginMaxAttempts !== undefined)
    loginData.loginMaxAttempts = clampLoginMaxAttempts(Number(body.loginMaxAttempts));
  if (body.loginLockoutMinutes !== undefined)
    loginData.loginLockoutMinutes = clampLoginLockoutMinutes(Number(body.loginLockoutMinutes));

  // Backup schedule — only persist provided fields, clamped to safe bounds.
  const backupData: Record<string, number | boolean> = {};
  if (typeof body.backupEnabled === 'boolean') backupData.backupEnabled = body.backupEnabled;
  if (body.backupHour !== undefined)
    backupData.backupHour = clampBackupHour(Number(body.backupHour));
  if (body.backupRetentionDays !== undefined)
    backupData.backupRetentionDays = clampBackupRetentionDays(Number(body.backupRetentionDays));
  if (body.activityLogRetentionDays !== undefined)
    backupData.activityLogRetentionDays = clampActivityLogRetentionDays(
      Number(body.activityLogRetentionDays),
    );

  // hCaptcha keys: site key set/clear when provided; secret only updated when a
  // non-empty value is sent, or explicitly cleared. Empty secret means "keep".
  const hcaptchaData: Record<string, string | null> = {};
  if (typeof body.hcaptchaSiteKey === 'string') {
    hcaptchaData.hcaptchaSiteKey = body.hcaptchaSiteKey.trim() || null;
  }
  if (body.hcaptchaSecretClear === true) {
    hcaptchaData.hcaptchaSecretKey = null;
  } else if (typeof body.hcaptchaSecretKey === 'string' && body.hcaptchaSecretKey.trim() !== '') {
    hcaptchaData.hcaptchaSecretKey = body.hcaptchaSecretKey.trim();
  }

  const updateData: {
    timezone: string;
    maxUploadSizeMb: number;
    sessionTimeoutMinutes: number;
    allowSignup?: boolean;
  } & Record<string, unknown> = {
    timezone,
    maxUploadSizeMb,
    sessionTimeoutMinutes,
    ...queueData,
    ...loginData,
    ...backupData,
    ...hcaptchaData,
  };
  if (hasAllowSignup) updateData.allowSignup = body.allowSignup;

  const createData: {
    id: number;
    timezone: string;
    maxUploadSizeMb: number;
    sessionTimeoutMinutes: number;
    allowSignup?: boolean;
  } & Record<string, unknown> = {
    id: 1,
    timezone,
    maxUploadSizeMb,
    sessionTimeoutMinutes,
    ...queueData,
    ...loginData,
    ...backupData,
    ...hcaptchaData,
  };
  if (hasAllowSignup) createData.allowSignup = body.allowSignup;

  // Snapshot the prior state so the audit log can report what actually changed.
  const existing = await prisma.systemSettings.findUnique({ where: { id: 1 } });

  let settings;
  try {
    settings = await prisma.systemSettings.upsert({
      where: { id: 1 },
      update: updateData,
      create: createData,
    });
  } catch (err) {
    console.error('[system-settings] failed to persist update:', err);
    await safeAuditLog(req, {
      userId: session.user?.id,
      action: 'SYSTEM_SETTINGS_UPDATE_ERROR',
      severity: 'ERROR',
      category: 'SYSTEM',
      metadata: { error: err instanceof Error ? err.message : 'unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }

  // Audit the change: which fields moved (with before/after), plus whether the
  // hCaptcha secret was set or cleared — never its value. Skip a no-op save.
  const changes = diffSettings(
    existing as Record<string, unknown> | null,
    settings as unknown as Record<string, unknown>,
  );
  const hcaptchaSecretCleared = body.hcaptchaSecretClear === true;
  const hcaptchaSecretUpdated =
    !hcaptchaSecretCleared &&
    typeof body.hcaptchaSecretKey === 'string' &&
    body.hcaptchaSecretKey.trim() !== '';
  if (Object.keys(changes).length || hcaptchaSecretUpdated || hcaptchaSecretCleared) {
    await safeAuditLog(req, {
      userId: session.user?.id,
      action: 'SYSTEM_SETTINGS_UPDATED',
      severity: 'INFO',
      category: 'SYSTEM',
      metadata: {
        created: !existing,
        changedFields: Object.keys(changes),
        changes,
        hcaptchaSecretUpdated,
        hcaptchaSecretCleared,
      },
    });
  }

  return NextResponse.json({
    timezone: settings.timezone,
    maxUploadSizeMb: settings.maxUploadSizeMb,
    allowSignup: settings.allowSignup,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    submissionEvalTimeoutMs: settings.submissionEvalTimeoutMs,
    submissionEvalMaxMemoryMb: settings.submissionEvalMaxMemoryMb,
    submissionResubmitCooldownMs: settings.submissionResubmitCooldownMs,
    submissionMaxConcurrent: settings.submissionMaxConcurrent,
    submissionMaxAttempts: settings.submissionMaxAttempts,
    submissionAnalyzerLimit: settings.submissionAnalyzerLimit,
    loginMaxAttempts: settings.loginMaxAttempts,
    loginLockoutMinutes: settings.loginLockoutMinutes,
    backupEnabled: settings.backupEnabled,
    backupHour: settings.backupHour,
    backupRetentionDays: settings.backupRetentionDays,
    activityLogRetentionDays: settings.activityLogRetentionDays,
    hcaptchaSiteKey: settings.hcaptchaSiteKey ?? '',
    hcaptchaSecretConfigured: Boolean(settings.hcaptchaSecretKey),
  });
}
