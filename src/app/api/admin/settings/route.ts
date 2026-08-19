import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { safeAuditLog } from '@/lib/api/activity';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { parseDomainList } from '@/lib/email';
import { SystemSettingsUpdateSchema } from '@/schemas/systemSettings';
import { encryptSecret, SecretKeyError } from '@/lib/secret-encryption';
import { SMTP_AUTH_NEEDS_TLS } from '@/lib/mailer';
import {
  DEFAULT_LOGIN_MAX_ATTEMPTS,
  DEFAULT_LOGIN_LOCKOUT_MINUTES,
  DEFAULT_BACKUP_ENABLED,
  DEFAULT_BACKUP_HOUR,
  DEFAULT_SMTP_PORT,
  DEFAULT_BACKUP_RETENTION_DAYS,
  DEFAULT_ACTIVITY_LOG_RETENTION_DAYS,
  DEFAULT_ALLOW_SIGNUP,
  DEFAULT_SIGNUP_ALLOWED_DOMAINS,
  DEFAULT_CLOCK_24_HOUR,
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
// hCaptcha secret is deliberately excluded; we only log whether it was
// set/cleared, never its value.
const AUDITED_FIELDS = [
  'timezone',
  'maxUploadSizeMb',
  'allowSignup',
  'signupAllowedDomains',
  'clock24Hour',
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
/**
 * Returns the singleton system settings, falling back to defaults for any unset
 * field. The hCaptcha secret is never returned; only `hcaptchaSecretConfigured`
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
 *             signupAllowedDomains: { type: string, description: Comma-separated email-domain allow-list; blank = any }
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
 *             configuredUrl: { type: string, description: Read-only NEXTAUTH_URL (the app public address); set at the server level and not editable here }
 *   403: { description: Caller is not a system administrator. }
 */
export const GET = withAdminAuth(
  async () => {
    // The whole row on purpose, unlike the public endpoint's narrowed read. This handler
    // uses 20 of the 22 columns, including the hCaptcha secret, which it reports only as
    // the `hcaptchaSecretConfigured` boolean below. A select here would restate the
    // response shape and add a quiet failure mode: a new setting whose column is missing
    // from the list reads as undefined and silently serves its default instead.
    const settings = await prisma.systemSettings.findUnique({ where: { id: 1 } });
    return NextResponse.json({
      // Read-only: the public address is an environment variable (NEXTAUTH_URL) set by
      // the installer, not a stored setting. Surfaced so an admin can see it without
      // shell access; it can only be changed by re-running the installer + restart.
      configuredUrl: process.env.NEXTAUTH_URL?.trim() ?? '',
      timezone: settings?.timezone ?? DEFAULT_SYSTEM_TIMEZONE,
      maxUploadSizeMb: settings?.maxUploadSizeMb ?? DEFAULT_MAX_UPLOAD_SIZE_MB,
      allowSignup: settings?.allowSignup ?? DEFAULT_ALLOW_SIGNUP,
      signupAllowedDomains: settings?.signupAllowedDomains ?? DEFAULT_SIGNUP_ALLOWED_DOMAINS,
      clock24Hour: settings?.clock24Hour ?? DEFAULT_CLOCK_24_HOUR,
      sessionTimeoutMinutes: settings?.sessionTimeoutMinutes ?? DEFAULT_SESSION_TIMEOUT_MINUTES,
      submissionEvalTimeoutMs:
        settings?.submissionEvalTimeoutMs ?? DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS,
      submissionEvalMaxMemoryMb:
        settings?.submissionEvalMaxMemoryMb ?? DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB,
      submissionResubmitCooldownMs:
        settings?.submissionResubmitCooldownMs ?? DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS,
      submissionMaxConcurrent:
        settings?.submissionMaxConcurrent ?? DEFAULT_SUBMISSION_MAX_CONCURRENT,
      submissionMaxAttempts: settings?.submissionMaxAttempts ?? DEFAULT_SUBMISSION_MAX_ATTEMPTS,
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
      // Mail settings. The password follows the hCaptcha secret's pattern: never returned,
      // only whether one is stored.
      smtpEnabled: settings?.smtpEnabled ?? false,
      smtpHost: settings?.smtpHost ?? '',
      smtpPort: settings?.smtpPort ?? DEFAULT_SMTP_PORT,
      smtpSecurity: settings?.smtpSecurity ?? 'STARTTLS',
      smtpUsername: settings?.smtpUsername ?? '',
      smtpPasswordConfigured: Boolean(settings?.smtpPassword),
      smtpFromAddress: settings?.smtpFromAddress ?? '',
      smtpFromName: settings?.smtpFromName ?? '',
      // Institutional sign-in. The client secret follows the same rule as the others: never
      // returned, only whether one is stored.
      oidcEnabled: settings?.oidcEnabled ?? false,
      oidcIssuer: settings?.oidcIssuer ?? '',
      oidcClientId: settings?.oidcClientId ?? '',
      oidcClientSecretConfigured: Boolean(settings?.oidcClientSecret),
      oidcButtonLabel: settings?.oidcButtonLabel ?? '',
      oidcTrustEmail: settings?.oidcTrustEmail ?? false,
    });
  },
  { deniedAction: 'SYSTEM_SETTINGS_VIEW_DENIED' },
);

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
export const PUT = withAdminAuth(
  async (req, _ctx, { user }) => {
    // Validate + clamp the payload. The schema coerces and clamps numeric fields to
    // their safe bounds (see src/schemas/systemSettings.ts) and rejects an invalid
    // timezone or malformed JSON with a 400.
    const parsed = await readJson(req, SystemSettingsUpdateSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    // timezone + the two core numeric fields are always applied (the schema
    // defaults/clamps them); the rest are applied only when present.
    const timezone = body.timezone;
    const maxUploadSizeMb = body.maxUploadSizeMb;
    const sessionTimeoutMinutes = body.sessionTimeoutMinutes;
    const hasAllowSignup = body.allowSignup !== undefined;
    const hasClock24Hour = body.clock24Hour !== undefined;

    // Signup email-domain allow-list: only persist when provided. Normalize to the
    // canonical comma-separated form and reject any malformed domain up front.
    const signupData: Record<string, string> = {};
    if (typeof body.signupAllowedDomains === 'string') {
      const { domains, invalid } = parseDomainList(body.signupAllowedDomains);
      if (invalid.length) {
        return NextResponse.json(
          { error: `Invalid email domain(s): ${invalid.join(', ')}` },
          { status: 400 },
        );
      }
      signupData.signupAllowedDomains = domains.join(',');
    }

    // Queue settings are optional in the payload; only persist the ones provided so
    // a partial update can't reset the others.
    const queueData: Record<string, number> = {};
    if (body.submissionEvalTimeoutMs !== undefined)
      queueData.submissionEvalTimeoutMs = body.submissionEvalTimeoutMs;
    if (body.submissionEvalMaxMemoryMb !== undefined)
      queueData.submissionEvalMaxMemoryMb = body.submissionEvalMaxMemoryMb;
    if (body.submissionResubmitCooldownMs !== undefined)
      queueData.submissionResubmitCooldownMs = body.submissionResubmitCooldownMs;
    if (body.submissionMaxConcurrent !== undefined)
      queueData.submissionMaxConcurrent = body.submissionMaxConcurrent;
    if (body.submissionMaxAttempts !== undefined)
      queueData.submissionMaxAttempts = body.submissionMaxAttempts;
    if (body.submissionAnalyzerLimit !== undefined)
      queueData.submissionAnalyzerLimit = body.submissionAnalyzerLimit;

    // Login lockout policy: only persist the fields provided, clamped to safe bounds.
    const loginData: Record<string, number> = {};
    if (body.loginMaxAttempts !== undefined) loginData.loginMaxAttempts = body.loginMaxAttempts;
    if (body.loginLockoutMinutes !== undefined)
      loginData.loginLockoutMinutes = body.loginLockoutMinutes;

    // Backup schedule: only persist provided fields, clamped to safe bounds.
    const backupData: Record<string, number | boolean> = {};
    if (body.backupEnabled !== undefined) backupData.backupEnabled = body.backupEnabled;
    if (body.backupHour !== undefined) backupData.backupHour = body.backupHour;
    if (body.backupRetentionDays !== undefined)
      backupData.backupRetentionDays = body.backupRetentionDays;
    if (body.activityLogRetentionDays !== undefined)
      backupData.activityLogRetentionDays = body.activityLogRetentionDays;

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

    // Mail settings. The password is encrypted before it is stored, and follows the same
    // write-only rule as the hCaptcha secret: an empty value means "keep what is there", so
    // saving the form without retyping the password does not wipe it.
    const smtpData: Record<string, unknown> = {};
    if (typeof body.smtpEnabled === 'boolean') smtpData.smtpEnabled = body.smtpEnabled;
    if (typeof body.smtpHost === 'string') smtpData.smtpHost = body.smtpHost.trim() || null;
    if (typeof body.smtpPort === 'number') smtpData.smtpPort = body.smtpPort;
    if (typeof body.smtpSecurity === 'string') smtpData.smtpSecurity = body.smtpSecurity;
    if (typeof body.smtpUsername === 'string')
      smtpData.smtpUsername = body.smtpUsername.trim() || null;
    if (typeof body.smtpFromAddress === 'string')
      smtpData.smtpFromAddress = body.smtpFromAddress.trim() || null;
    if (typeof body.smtpFromName === 'string')
      smtpData.smtpFromName = body.smtpFromName.trim() || null;

    /**
     * The password is stored exactly as typed.
     *
     * It used to be trimmed, which is right for a hostname and wrong for a secret: a password of
     * `" hunter2 "` was silently stored as `"hunter2"` and then rejected by the mail server, with
     * nothing on any screen to explain why. An opaque secret is whatever the other end says it
     * is, spaces included.
     *
     * The empty string still means "keep what is there", so saving the form without retyping the
     * password does not wipe it. That is a different thing from a password made of spaces, which
     * is a real value and is kept.
     */
    if (body.smtpPasswordClear === true) {
      smtpData.smtpPassword = null;
    } else if (typeof body.smtpPassword === 'string' && body.smtpPassword !== '') {
      try {
        smtpData.smtpPassword = encryptSecret(body.smtpPassword);
      } catch (error) {
        // No key means the password cannot be stored safely, and storing it in the clear to
        // be helpful would defeat the point of encrypting it at all.
        return NextResponse.json(
          {
            error:
              error instanceof SecretKeyError
                ? `The mail password cannot be saved. ${error.message}`
                : 'The mail password could not be saved.',
          },
          { status: 500 },
        );
      }
    }

    /**
     * Credentials are not allowed over an unencrypted connection.
     *
     * SMTP AUTH on a plain connection puts the username and password on the wire in clear text,
     * and at most institutions that is a directory account rather than a mail-only one. `NONE`
     * itself stays supported, because an unauthenticated local relay is a normal thing to have;
     * what is refused is `NONE` *with* credentials.
     *
     * Judged on the configuration this save would produce, not on what the form sent. A request
     * that changes only the security setting has to be checked against the username and password
     * already stored, or the rule could be walked around in two saves.
     */
    const storedSmtp = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: {
        smtpSecurity: true,
        smtpUsername: true,
        smtpPassword: true,
        // Read in the same breath, for the same reason: the institutional sign-in rule below
        // is judged on what this save would leave behind, not on what the form happened to send.
        oidcEnabled: true,
        oidcIssuer: true,
        oidcClientId: true,
        oidcClientSecret: true,
      },
    });
    const storedOidc = storedSmtp;
    const resultingSecurity =
      typeof smtpData.smtpSecurity === 'string' ? smtpData.smtpSecurity : storedSmtp?.smtpSecurity;
    const resultingUsername =
      'smtpUsername' in smtpData ? smtpData.smtpUsername : (storedSmtp?.smtpUsername ?? null);
    const resultingPassword =
      'smtpPassword' in smtpData ? smtpData.smtpPassword : (storedSmtp?.smtpPassword ?? null);

    if (resultingSecurity === 'NONE' && (resultingUsername || resultingPassword)) {
      return NextResponse.json({ error: SMTP_AUTH_NEEDS_TLS }, { status: 400 });
    }

    // Institutional sign-in, same write-only rule for the secret as the two above.
    const oidcData: Record<string, unknown> = {};
    if (typeof body.oidcEnabled === 'boolean') oidcData.oidcEnabled = body.oidcEnabled;
    if (typeof body.oidcIssuer === 'string') oidcData.oidcIssuer = body.oidcIssuer.trim() || null;
    if (typeof body.oidcClientId === 'string')
      oidcData.oidcClientId = body.oidcClientId.trim() || null;
    if (typeof body.oidcButtonLabel === 'string')
      oidcData.oidcButtonLabel = body.oidcButtonLabel.trim() || null;
    if (typeof body.oidcTrustEmail === 'boolean') oidcData.oidcTrustEmail = body.oidcTrustEmail;

    if (body.oidcClientSecretClear === true) {
      oidcData.oidcClientSecret = null;
    } else if (typeof body.oidcClientSecret === 'string' && body.oidcClientSecret !== '') {
      try {
        // Stored exactly as given. A client secret is opaque: whitespace at either end may be
        // part of it, and trimming it produces an authentication failure the administrator
        // cannot see the cause of. The SMTP password beside this has always been handled so.
        oidcData.oidcClientSecret = encryptSecret(body.oidcClientSecret);
      } catch (error) {
        return NextResponse.json(
          {
            error:
              error instanceof SecretKeyError
                ? `The sign-in client secret cannot be saved. ${error.message}`
                : 'The sign-in client secret could not be saved.',
          },
          { status: 500 },
        );
      }
    }

    /**
     * Enabled has to mean usable.
     *
     * Nothing stopped an administrator turning institutional sign-in on with no issuer, no
     * client id or no secret, or clearing the secret while leaving it on. `getOidcConfig` then
     * returns null, so the button silently disappears from the sign-in page while this screen
     * goes on saying it is enabled, and the person who turned it on has no way to tell that
     * nobody can use it. Checked against what the settings will be after this write, not
     * against what was sent, so changing one field does not require resending the others.
     */
    const resultingOidcEnabled =
      'oidcEnabled' in oidcData ? oidcData.oidcEnabled : (storedOidc?.oidcEnabled ?? false);
    if (resultingOidcEnabled) {
      const resultingIssuer =
        'oidcIssuer' in oidcData ? oidcData.oidcIssuer : (storedOidc?.oidcIssuer ?? null);
      const resultingClientId =
        'oidcClientId' in oidcData ? oidcData.oidcClientId : (storedOidc?.oidcClientId ?? null);
      const resultingSecret =
        'oidcClientSecret' in oidcData
          ? oidcData.oidcClientSecret
          : (storedOidc?.oidcClientSecret ?? null);

      const missing = [
        resultingIssuer ? null : 'the issuer URL',
        resultingClientId ? null : 'the client ID',
        resultingSecret ? null : 'the client secret',
      ].filter((part): part is string => part !== null);

      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: `Institutional sign-in needs ${missing.join(', ')} before it can be turned on. Add ${missing.length === 1 ? 'it' : 'them'}, or leave institutional sign-in off.`,
          },
          { status: 400 },
        );
      }
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
      ...smtpData,
      ...oidcData,
      ...signupData,
    };
    if (hasAllowSignup) updateData.allowSignup = body.allowSignup;
    if (hasClock24Hour) updateData.clock24Hour = body.clock24Hour;

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
      ...smtpData,
      ...oidcData,
      ...signupData,
    };
    if (hasAllowSignup) createData.allowSignup = body.allowSignup;
    if (hasClock24Hour) createData.clock24Hour = body.clock24Hour;

    // Snapshot the prior state so the audit log can report what actually changed.
    // Whole row on purpose: diffSettings reads it by key over AUDITED_FIELDS, so a select
    // that fell behind that list would make a field read as undefined and log a change
    // that never happened. The hCaptcha secret is not an audited field, so its value is
    // never diffed or recorded.
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
      await safeAuditLog('system-settings', req, {
        userId: user.id,
        action: 'SYSTEM_SETTINGS_UPDATE_ERROR',
        severity: 'ERROR',
        category: 'SYSTEM',
        metadata: { error: err instanceof Error ? err.message : 'unknown error' },
      });
      return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
    }

    // Audit the change: which fields moved (with before/after), plus whether the
    // hCaptcha secret was set or cleared, never its value. Skip a no-op save.
    const changes = diffSettings(
      existing as Record<string, unknown> | null,
      settings as unknown as Record<string, unknown>,
    );
    const hcaptchaSecretCleared = body.hcaptchaSecretClear === true;
    const hcaptchaSecretUpdated =
      !hcaptchaSecretCleared &&
      typeof body.hcaptchaSecretKey === 'string' &&
      body.hcaptchaSecretKey.trim() !== '';
    // The mail password is not an audited field (its value must never reach the log), so
    // record that it changed the same way the hCaptcha secret does.
    const smtpPasswordCleared = body.smtpPasswordClear === true;
    const smtpPasswordUpdated =
      !smtpPasswordCleared &&
      typeof body.smtpPassword === 'string' &&
      body.smtpPassword.trim() !== '';
    if (
      Object.keys(changes).length ||
      hcaptchaSecretUpdated ||
      hcaptchaSecretCleared ||
      smtpPasswordUpdated ||
      smtpPasswordCleared
    ) {
      await safeAuditLog('system-settings', req, {
        userId: user.id,
        action: 'SYSTEM_SETTINGS_UPDATED',
        severity: 'INFO',
        category: 'SYSTEM',
        metadata: {
          created: !existing,
          changedFields: Object.keys(changes),
          changes,
          hcaptchaSecretUpdated,
          hcaptchaSecretCleared,
          smtpPasswordUpdated,
          smtpPasswordCleared,
        },
      });
    }

    return NextResponse.json({
      timezone: settings.timezone,
      maxUploadSizeMb: settings.maxUploadSizeMb,
      allowSignup: settings.allowSignup,
      signupAllowedDomains: settings.signupAllowedDomains,
      clock24Hour: settings.clock24Hour,
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
      smtpEnabled: settings.smtpEnabled ?? false,
      smtpHost: settings.smtpHost ?? '',
      smtpPort: settings.smtpPort ?? DEFAULT_SMTP_PORT,
      smtpSecurity: settings.smtpSecurity ?? 'STARTTLS',
      smtpUsername: settings.smtpUsername ?? '',
      smtpPasswordConfigured: Boolean(settings.smtpPassword),
      smtpFromAddress: settings.smtpFromAddress ?? '',
      smtpFromName: settings.smtpFromName ?? '',
      oidcEnabled: settings.oidcEnabled ?? false,
      oidcIssuer: settings.oidcIssuer ?? '',
      oidcClientId: settings.oidcClientId ?? '',
      oidcClientSecretConfigured: Boolean(settings.oidcClientSecret),
      oidcButtonLabel: settings.oidcButtonLabel ?? '',
      oidcTrustEmail: settings.oidcTrustEmail ?? false,
    });
  },
  { deniedAction: 'SYSTEM_SETTINGS_UPDATE_DENIED' },
);
