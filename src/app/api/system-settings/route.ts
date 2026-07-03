import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { COMMON_TIMEZONES } from '@/lib/timezones';
import {
  clampSessionTimeoutMinutes,
  clampSubmissionEvalTimeoutMs,
  clampSubmissionEvalMaxMemoryMb,
  clampSubmissionResubmitCooldownMs,
  clampSubmissionMaxConcurrent,
  clampSubmissionMaxAttempts,
  clampSubmissionAnalyzerLimit,
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

export async function GET() {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !['ADMIN', 'FACULTY'].includes(role)) {
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
  hcaptchaSiteKey?: string;
  hcaptchaSecretKey?: string;
  hcaptchaSecretClear?: boolean;
};

export async function PUT(req: Request) {
  const session = await auth();
  const role = session?.user?.role;
  if (!role || !['ADMIN', 'FACULTY'].includes(role)) {
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
    ...hcaptchaData,
  };
  if (hasAllowSignup) createData.allowSignup = body.allowSignup;

  const settings = await prisma.systemSettings.upsert({
    where: { id: 1 },
    update: updateData,
    create: createData,
  });

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
    hcaptchaSiteKey: settings.hcaptchaSiteKey ?? '',
    hcaptchaSecretConfigured: Boolean(settings.hcaptchaSecretKey),
  });
}
