// src/schemas/systemSettings.ts
//
// Validation schema for the system-settings update payload (PUT /api/system-settings).
// The app deliberately *clamps* numeric settings to safe bounds rather than
// rejecting out-of-range values (see src/lib/system-settings.ts and its rationale
// comments), so this schema coerces then clamps via the same helpers — a value
// that's out of range is corrected to the nearest bound, not refused. Timezone and
// the signup domain list are the fields that genuinely reject bad input.
//
// Shared by the route (server-side validation) and available to the admin
// System Settings form.
import { z } from 'zod';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import {
  clampUploadSizeMb,
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
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
} from '@/lib/system-settings';

/**
 * Coerce to a number, then clamp to the setting's safe bounds. A value that can't
 * be coerced (e.g. a non-numeric string) falls through to `NaN`, which every clamp
 * helper maps to the field's default — matching the route's original lenient
 * `Number(...)`-then-clamp behavior rather than rejecting the whole request.
 */
const clamped = (clamp: (v: number) => number) =>
  z.coerce.number().catch(Number.NaN).transform(clamp);

export const SystemSettingsUpdateSchema = z.object({
  // Rejected (not clamped): must be a known IANA zone.
  timezone: z
    .string()
    .refine((v) => COMMON_TIMEZONES.includes(v as (typeof COMMON_TIMEZONES)[number]), {
      message: 'Invalid timezone',
    }),

  // Always applied; clamped. Defaulted when the form omits them.
  maxUploadSizeMb: clamped(clampUploadSizeMb).default(DEFAULT_MAX_UPLOAD_SIZE_MB),
  sessionTimeoutMinutes: clamped(clampSessionTimeoutMinutes).default(DEFAULT_SESSION_TIMEOUT_MINUTES),

  // Display / signup toggles.
  allowSignup: z.boolean().optional(),
  clock24Hour: z.boolean().optional(),

  // Signup email-domain allow-list (validated + normalized further in the route).
  signupAllowedDomains: z.string().optional(),

  // Submission queue — each optional (partial update) and clamped when present.
  submissionEvalTimeoutMs: clamped(clampSubmissionEvalTimeoutMs).optional(),
  submissionEvalMaxMemoryMb: clamped(clampSubmissionEvalMaxMemoryMb).optional(),
  submissionResubmitCooldownMs: clamped(clampSubmissionResubmitCooldownMs).optional(),
  submissionMaxConcurrent: clamped(clampSubmissionMaxConcurrent).optional(),
  submissionMaxAttempts: clamped(clampSubmissionMaxAttempts).optional(),
  submissionAnalyzerLimit: clamped(clampSubmissionAnalyzerLimit).optional(),

  // Login lockout policy.
  loginMaxAttempts: clamped(clampLoginMaxAttempts).optional(),
  loginLockoutMinutes: clamped(clampLoginLockoutMinutes).optional(),

  // Backups + audit-log retention.
  backupEnabled: z.boolean().optional(),
  backupHour: clamped(clampBackupHour).optional(),
  backupRetentionDays: clamped(clampBackupRetentionDays).optional(),
  activityLogRetentionDays: clamped(clampActivityLogRetentionDays).optional(),

  // hCaptcha keys. The site key is set/cleared; the secret is only updated when a
  // non-empty value is sent, or explicitly cleared via hcaptchaSecretClear.
  hcaptchaSiteKey: z.string().optional(),
  hcaptchaSecretKey: z.string().optional(),
  hcaptchaSecretClear: z.boolean().optional(),
});

/** Raw form/request input (pre-coercion). */
export type SystemSettingsUpdateInput = z.input<typeof SystemSettingsUpdateSchema>;
/** Parsed + clamped output. */
export type SystemSettingsUpdate = z.output<typeof SystemSettingsUpdateSchema>;
