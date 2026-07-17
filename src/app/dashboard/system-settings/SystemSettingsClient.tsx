'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { apiPaths } from '@/lib/api-paths';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';
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
  MAX_SESSION_TIMEOUT_MINUTES,
  MIN_SESSION_TIMEOUT_MINUTES,
  MIN_SUBMISSION_EVAL_TIMEOUT_MS,
  MAX_SUBMISSION_EVAL_TIMEOUT_MS,
  MIN_SUBMISSION_EVAL_MAX_MEMORY_MB,
  MAX_SUBMISSION_EVAL_MAX_MEMORY_MB,
  MIN_SUBMISSION_RESUBMIT_COOLDOWN_MS,
  MAX_SUBMISSION_RESUBMIT_COOLDOWN_MS,
  MIN_SUBMISSION_MAX_CONCURRENT,
  MAX_SUBMISSION_MAX_CONCURRENT,
  MIN_SUBMISSION_MAX_ATTEMPTS,
  MAX_SUBMISSION_MAX_ATTEMPTS,
  MIN_SUBMISSION_ANALYZER_LIMIT,
  MAX_SUBMISSION_ANALYZER_LIMIT,
  MIN_LOGIN_MAX_ATTEMPTS,
  MAX_LOGIN_MAX_ATTEMPTS,
  MIN_LOGIN_LOCKOUT_MINUTES,
  MAX_LOGIN_LOCKOUT_MINUTES,
  MIN_BACKUP_HOUR,
  MAX_BACKUP_HOUR,
  MIN_BACKUP_RETENTION_DAYS,
  MAX_BACKUP_RETENTION_DAYS,
  MIN_ACTIVITY_LOG_RETENTION_DAYS,
  MAX_ACTIVITY_LOG_RETENTION_DAYS,
} from '@/lib/system-settings';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import SwitchField from '@/components/ui/SwitchField';
import { parseDomainList } from '@/lib/email';
import { SystemSettingsUpdateSchema } from '@/schemas/systemSettings';
import FileUploadInput from '@/components/FileUploadInput';
import { useTlsCertificate } from './useTlsCertificate';
import { useBackups } from './useBackups';
import { useUpgrade, isUpgradeInProgress } from './useUpgrade';

type SystemSettingsResponse = {
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
type FormSnapshot = {
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

const msToSec = (ms: number) => Math.round(ms / 1000);
const secToMs = (sec: number) => Math.round(sec * 1000);

const formatBytes = (n: number | null) => {
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
const formatBackupTs = (ts: string) => {
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
const upgradePhaseLabel = (phase: string) =>
  UPGRADE_PHASE_LABELS[phase] ?? phase.replace(/_/g, ' ');

const SETTINGS_TAB_KEY = 'afct.systemSettingsTab';
const SETTINGS_TABS = ['general', 'queue', 'backups', 'captcha', 'tls', 'updates'];

// Normalize a raw settings response into the editable form snapshot (defaults,
// clamping, ms→sec conversions). Shared so the form can be seeded both
// synchronously from a warm cache and via the effect on a cold load.
function buildSettingsSnapshot(data: SystemSettingsResponse): FormSnapshot {
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

// The Save-covered form is one reducer-managed object. `set` updates a single field
// (typed via the setField wrapper below); `reset` replaces the whole snapshot on seed.
type FormAction =
  | { type: 'reset'; snapshot: FormSnapshot }
  | { [K in keyof FormSnapshot]: { type: 'set'; field: K; value: FormSnapshot[K] } }[keyof FormSnapshot];

function formReducer(state: FormSnapshot, action: FormAction): FormSnapshot {
  if (action.type === 'reset') return action.snapshot;
  return { ...state, [action.field]: action.value };
}

// Cold-start values (before the settings response seeds the form). Field order matches
// buildSettingsSnapshot so the JSON.stringify dirty-check compares like-ordered objects.
const EMPTY_FORM: FormSnapshot = {
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

export default function SystemSettingsClient() {
  const queryClient = useQueryClient();

  // Cached system-settings read. The response seeds the editable form once; the
  // form's own local state is the source of truth after that, so navigating back
  // to this page shows the cached values instantly instead of reloading.
  const {
    data: settingsData,
    isLoading: settingsLoading,
    isError: settingsError,
  } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: async () => {
      const res = await fetch(apiPaths.admin.settings(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load system settings');
      return (await res.json()) as SystemSettingsResponse;
    },
    staleTime: 30_000,
  });

  // Seed the form synchronously from whatever the cache holds on the first render.
  // On a warm remount `settingsData` is already present, so the fields initialize
  // populated (and enabled) with no flash; a cold load leaves this null and the
  // effect below seeds once the fetch resolves.
  const [initialSeed] = useState<FormSnapshot | null>(() =>
    settingsData ? buildSettingsSnapshot(settingsData) : null,
  );

  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('general');
  // The ~19 Save-covered fields live in one reducer-managed object (was one useState
  // slice each). `setField` is the typed single-field updater the field JSX calls; a
  // whole-object `reset` seeds/restores the form (on load, Cancel, and after save).
  const [form, dispatchForm] = useReducer(formReducer, initialSeed ?? EMPTY_FORM);
  const setField = useCallback(
    <K extends keyof FormSnapshot>(field: K, value: FormSnapshot[K]) => {
      dispatchForm({ type: 'set', field, value } as FormAction);
    },
    [],
  );

  const {
    timezone,
    maxUploadSizeMb,
    allowSignup,
    signupAllowedDomains,
    clock24Hour,
    sessionTimeoutMinutes,
    evalTimeoutSec,
    resubmitCooldownSec,
    evalMaxMemoryMb,
    maxConcurrent,
    maxAttempts,
    analyzerLimit,
    loginMaxAttempts,
    loginLockoutMinutes,
    backupEnabled,
    backupHour,
    backupRetentionDays,
    activityLogRetentionDays,
    hcaptchaSiteKey,
  } = form;

  // Available backups + the "Back up now" action (managed independently of the
  // settings form's Save) live in a dedicated hook.
  const { backups, backupsLoading, backupNowBusy, handleBackupNow } = useBackups();

  // Upgrade panel (Updates tab). Query only runs while that tab is open.
  const {
    info: upgradeInfo,
    loading: upgradeLoading,
    upgradeBusy,
    downgradeBusy,
    startUpgrade,
    startDowngrade,
  } = useUpgrade(tab === 'updates');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [confirmUpgradeOpen, setConfirmUpgradeOpen] = useState(false);
  // Focus target for closing the upgrade/restore dialogs: their trigger buttons
  // are disabled once the action starts, so Radix's default focus return would
  // land on <body>. Send focus to the status panel instead.
  const upgradeStatusRef = useRef<HTMLDivElement | null>(null);
  const upgradeInProgress = isUpgradeInProgress(upgradeInfo?.status);
  const upgradeableVersions = (upgradeInfo?.versions ?? []).filter(
    (v) => v.tag !== upgradeInfo?.current,
  );
  const selectedVersionInfo = upgradeableVersions.find((v) => v.tag === selectedVersion);
  // Downgrade (restore) confirm: destructive, so gated behind a type-the-version box.
  const [restoreTarget, setRestoreTarget] = useState<{ version: string; backup: string } | null>(
    null,
  );
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const restorePoints = (upgradeInfo?.restorePoints ?? []).filter(
    (r) => r.version !== upgradeInfo?.current,
  );

  // hCaptcha keys. The site key is part of the main form object above; the secret is
  // write-only (we only know whether one is set), so it stays local.
  const [hcaptchaSecretKey, setHcaptchaSecretKey] = useState('');
  const [hcaptchaSecretConfigured, setHcaptchaSecretConfigured] = useState(() =>
    Boolean(settingsData?.hcaptchaSecretConfigured),
  );
  const [hcaptchaSecretClear, setHcaptchaSecretClear] = useState(false);

  // Baseline of saved values, for unsaved-changes detection. Seeded synchronously
  // on a warm cache so `loading` (below) is false immediately: no disabled flash.
  const [baseline, setBaseline] = useState<FormSnapshot | null>(initialSeed);

  // TLS certificate: its cached read, upload/CSR/self-signed flows, and form state
  // live in a dedicated hook so this component owns only the main settings form.
  const {
    tls,
    tlsBusy,
    tlsMethod,
    setTlsMethod,
    certFile,
    setCertFile,
    keyFile,
    setKeyFile,
    chainFile,
    setChainFile,
    csrCommonName,
    setCsrCommonName,
    csrOrganization,
    setCsrOrganization,
    csrAltNames,
    setCsrAltNames,
    signedCertFile,
    setSignedCertFile,
    signedChainFile,
    setSignedChainFile,
    cnMissing,
    applyCert,
    resetCert,
    generateCsr,
    installSignedCert,
    generateSelfSigned,
  } = useTlsCertificate();

  // Seed the editable form from the cached settings response, once. Guarded on
  // `baseline` so a later background refetch can't clobber in-progress edits.
  useEffect(() => {
    if (!settingsData || baseline) return;
    const norm = buildSettingsSnapshot(settingsData);

    dispatchForm({ type: 'reset', snapshot: norm });
    setHcaptchaSecretConfigured(Boolean(settingsData.hcaptchaSecretConfigured));
    setHcaptchaSecretKey('');
    setHcaptchaSecretClear(false);
    setBaseline(norm);
  }, [settingsData, baseline]);

  // Surface a load failure the same way the imperative fetch did.
  useEffect(() => {
    if (settingsError) showToast.error('Failed to load system settings.');
  }, [settingsError]);

  // Restore the last-viewed tab on load, and remember it on change.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_TAB_KEY);
      if (saved && SETTINGS_TABS.includes(saved)) setTab(saved);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleTabChange = (value: string) => {
    setTab(value);
    try {
      localStorage.setItem(SETTINGS_TAB_KEY, value);
    } catch {
      // ignore storage errors
    }
  };

  const timezoneOptions = useMemo(
    () =>
      COMMON_TIMEZONES.map((tz) => ({
        value: tz,
        label: formatTimezoneLabel(tz),
      })),
    [],
  );

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!timezone || !COMMON_TIMEZONES.includes(timezone as (typeof COMMON_TIMEZONES)[number])) {
      showToast.error('Please select a valid timezone.');
      return;
    }

    const clampedSize = Math.max(1, Math.min(1024, Math.trunc(Number(maxUploadSizeMb) || 0)));
    const clampedTimeout = clampSessionTimeoutMinutes(Number(sessionTimeoutMinutes));
    const evalTimeoutMs = clampSubmissionEvalTimeoutMs(secToMs(Number(evalTimeoutSec)));
    const resubmitCooldownMs = clampSubmissionResubmitCooldownMs(
      secToMs(Number(resubmitCooldownSec)),
    );
    const memoryMb = clampSubmissionEvalMaxMemoryMb(Number(evalMaxMemoryMb));
    const concurrent = clampSubmissionMaxConcurrent(Number(maxConcurrent));
    const attempts = clampSubmissionMaxAttempts(Number(maxAttempts));
    const analyzer = clampSubmissionAnalyzerLimit(Number(analyzerLimit));
    const loginAttempts = clampLoginMaxAttempts(Number(loginMaxAttempts));
    const lockoutMinutes = clampLoginLockoutMinutes(Number(loginLockoutMinutes));
    const bkpHour = clampBackupHour(Number(backupHour));
    const bkpRetention = clampBackupRetentionDays(Number(backupRetentionDays));
    const logRetention = clampActivityLogRetentionDays(Number(activityLogRetentionDays));
    // Canonicalize the domain allow-list (dedupe/lowercase) so what we display and
    // cache after saving matches exactly what the server stores.
    const canonicalDomains = parseDomainList(signupAllowedDomains).domains.join(',');

    // Validate + normalize the whole payload through the shared schema (the same
    // one the route validates with) before sending. Surfaces any field error
    // (e.g. an invalid timezone) as a toast and makes the schema the single
    // authority for the request shape.
    const parsedSettings = SystemSettingsUpdateSchema.safeParse({
      timezone,
      maxUploadSizeMb: clampedSize,
      allowSignup,
      signupAllowedDomains: canonicalDomains,
      clock24Hour,
      sessionTimeoutMinutes: clampedTimeout,
      submissionEvalTimeoutMs: evalTimeoutMs,
      submissionResubmitCooldownMs: resubmitCooldownMs,
      submissionEvalMaxMemoryMb: memoryMb,
      submissionMaxConcurrent: concurrent,
      submissionMaxAttempts: attempts,
      submissionAnalyzerLimit: analyzer,
      loginMaxAttempts: loginAttempts,
      loginLockoutMinutes: lockoutMinutes,
      backupEnabled,
      backupHour: bkpHour,
      backupRetentionDays: bkpRetention,
      activityLogRetentionDays: logRetention,
      hcaptchaSiteKey: hcaptchaSiteKey.trim(),
      ...(hcaptchaSecretClear
        ? { hcaptchaSecretClear: true }
        : hcaptchaSecretKey.trim()
          ? { hcaptchaSecretKey: hcaptchaSecretKey.trim() }
          : {}),
    });
    if (!parsedSettings.success) {
      showToast.error(
        parsedSettings.error.issues[0]?.message ?? 'Please review the settings and try again.',
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(apiPaths.admin.settings(), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsedSettings.data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Failed to save settings');
      }
      const savedSiteKey = hcaptchaSiteKey.trim();
      // Fold the saved (clamped/canonicalized) values back into the form and make them
      // the new baseline in one shot, so what's shown and the dirty-check both match
      // exactly what the server stored.
      const savedSnapshot: FormSnapshot = {
        timezone,
        maxUploadSizeMb: clampedSize,
        allowSignup,
        signupAllowedDomains: canonicalDomains,
        clock24Hour,
        sessionTimeoutMinutes: clampedTimeout,
        evalTimeoutSec: msToSec(evalTimeoutMs),
        resubmitCooldownSec: msToSec(resubmitCooldownMs),
        evalMaxMemoryMb: memoryMb,
        maxConcurrent: concurrent,
        maxAttempts: attempts,
        analyzerLimit: analyzer,
        loginMaxAttempts: loginAttempts,
        loginLockoutMinutes: lockoutMinutes,
        backupEnabled,
        backupHour: bkpHour,
        backupRetentionDays: bkpRetention,
        activityLogRetentionDays: logRetention,
        hcaptchaSiteKey: savedSiteKey,
      };
      dispatchForm({ type: 'reset', snapshot: savedSnapshot });
      setBaseline(savedSnapshot);
      setHcaptchaSecretConfigured(
        hcaptchaSecretClear ? false : hcaptchaSecretKey.trim() ? true : hcaptchaSecretConfigured,
      );
      setHcaptchaSecretKey('');
      setHcaptchaSecretClear(false);
      // Keep the read cache consistent with what we just saved so a later revisit
      // (served from cache) reflects the new values, not the pre-save response.
      queryClient.setQueryData<SystemSettingsResponse>(['admin', 'settings'], (prev) =>
        prev
          ? {
              ...prev,
              timezone,
              maxUploadSizeMb: clampedSize,
              allowSignup,
              signupAllowedDomains: canonicalDomains,
              clock24Hour,
              sessionTimeoutMinutes: clampedTimeout,
              submissionEvalTimeoutMs: evalTimeoutMs,
              submissionResubmitCooldownMs: resubmitCooldownMs,
              submissionEvalMaxMemoryMb: memoryMb,
              submissionMaxConcurrent: concurrent,
              submissionMaxAttempts: attempts,
              submissionAnalyzerLimit: analyzer,
              loginMaxAttempts: loginAttempts,
              loginLockoutMinutes: lockoutMinutes,
              backupEnabled,
              backupHour: bkpHour,
              backupRetentionDays: bkpRetention,
              activityLogRetentionDays: logRetention,
              hcaptchaSiteKey: savedSiteKey,
              hcaptchaSecretConfigured: hcaptchaSecretClear
                ? false
                : hcaptchaSecretKey.trim()
                  ? true
                  : prev.hcaptchaSecretConfigured,
            }
          : prev,
      );
      showToast.success('System settings updated successfully.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    if (!baseline) return;
    dispatchForm({ type: 'reset', snapshot: baseline });
    setHcaptchaSecretKey('');
    setHcaptchaSecretClear(false);
  };

  // "Loading" until the cached response has seeded the form, so fields never
  // flash empty on a cache-warm revisit (isLoading is already false then).
  const loading = settingsLoading || (!!settingsData && !baseline);
  const disabled = loading || saving;

  const currentSnapshot: FormSnapshot = {
    timezone,
    maxUploadSizeMb,
    allowSignup,
    signupAllowedDomains,
    clock24Hour,
    sessionTimeoutMinutes,
    evalTimeoutSec,
    resubmitCooldownSec,
    evalMaxMemoryMb,
    maxConcurrent,
    maxAttempts,
    analyzerLimit,
    loginMaxAttempts,
    loginLockoutMinutes,
    backupEnabled,
    backupHour,
    backupRetentionDays,
    activityLogRetentionDays,
    hcaptchaSiteKey,
  };
  const isDirty =
    !!baseline &&
    (JSON.stringify(currentSnapshot) !== JSON.stringify(baseline) ||
      hcaptchaSecretKey.trim() !== '' ||
      hcaptchaSecretClear);

  const hcaptchaEnabled =
    hcaptchaSiteKey.trim() !== '' ||
    hcaptchaSecretKey.trim() !== '' ||
    (hcaptchaSecretConfigured && !hcaptchaSecretClear);

  return (
    <div className="space-y-4 pb-8">
      <p className="sr-only" aria-live="polite">
        {loading ? 'Loading system settings' : saving ? 'Saving system settings' : ''}
      </p>

      <Card className="p-4">
        <CardHeader className="pb-2">
          <CardTitle role="heading" aria-level={1} className="text-2xl">
            System Settings
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            Manage server-wide configuration, security, uploads, evaluator behavior, and TLS.
          </p>
        </CardHeader>

        <CardContent>
          <Tabs value={tab} onValueChange={handleTabChange} className="w-full gap-6">
            <TabsList
              aria-label="System settings sections"
              className="bg-card border-border h-12 w-full justify-start gap-1 overflow-x-auto rounded-md border p-1 shadow-sm"
            >
              <TabsTrigger
                value="general"
                className="hover:bg-accent data-[state=active]:bg-secondary px-4 whitespace-nowrap data-[state=active]:text-white"
              >
                General
              </TabsTrigger>
              <TabsTrigger
                value="queue"
                className="hover:bg-accent data-[state=active]:bg-secondary px-4 whitespace-nowrap data-[state=active]:text-white"
              >
                Evaluator
              </TabsTrigger>
              <TabsTrigger
                value="backups"
                className="hover:bg-accent data-[state=active]:bg-secondary px-4 whitespace-nowrap data-[state=active]:text-white"
              >
                Backups
              </TabsTrigger>
              <TabsTrigger
                value="captcha"
                className="hover:bg-accent data-[state=active]:bg-secondary px-4 whitespace-nowrap data-[state=active]:text-white"
              >
                Captcha
              </TabsTrigger>
              <TabsTrigger
                value="tls"
                className="hover:bg-accent data-[state=active]:bg-secondary px-4 whitespace-nowrap data-[state=active]:text-white"
              >
                TLS Certificate
              </TabsTrigger>
              <TabsTrigger
                value="updates"
                className="hover:bg-accent data-[state=active]:bg-secondary px-4 whitespace-nowrap data-[state=active]:text-white"
              >
                Updates
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general">
              <p className="text-muted-foreground mb-4 text-sm">
                Server defaults for time, uploads, and sign-in.
              </p>
              {/* All General fields stacked in a single, consistently-sized column. */}
              <div className="max-w-md space-y-5">
                <SelectField
                  label="Timezone"
                  name="timezone"
                  id="timezone"
                  requiredMark
                  placeholder={loading ? 'Loading timezone...' : 'Select timezone'}
                  value={loading ? '' : timezone}
                  onValueChange={(val) => setField('timezone', val)}
                  disabled={disabled}
                  description="Default timezone for the server. Users can override this in their profile."
                  options={timezoneOptions}
                  triggerClassName="border-black"
                />
                <InputGroup
                  label="Max upload size (MB)"
                  name="maxUploadSizeMb"
                  type="number"
                  required
                  requiredMark
                  min={1}
                  max={1024}
                  value={maxUploadSizeMb === '' ? '' : String(maxUploadSizeMb)}
                  setValue={(val) => setField('maxUploadSizeMb', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description="Applies to all uploads. 1–1024 MB."
                />
                <InputGroup
                  label="Session timeout (minutes)"
                  name="sessionTimeoutMinutes"
                  type="number"
                  required
                  requiredMark
                  min={MIN_SESSION_TIMEOUT_MINUTES}
                  max={MAX_SESSION_TIMEOUT_MINUTES}
                  value={sessionTimeoutMinutes === '' ? '' : String(sessionTimeoutMinutes)}
                  setValue={(val) => setField('sessionTimeoutMinutes', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description={`Signs out after inactivity. ${MIN_SESSION_TIMEOUT_MINUTES}–${MAX_SESSION_TIMEOUT_MINUTES} min.`}
                />
                <InputGroup
                  label="Failed logins before lockout"
                  name="loginMaxAttempts"
                  type="number"
                  required
                  requiredMark
                  min={MIN_LOGIN_MAX_ATTEMPTS}
                  max={MAX_LOGIN_MAX_ATTEMPTS}
                  value={loginMaxAttempts === '' ? '' : String(loginMaxAttempts)}
                  setValue={(val) => setField('loginMaxAttempts', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description={`Failed attempts on one account before it's temporarily locked. ${MIN_LOGIN_MAX_ATTEMPTS}–${MAX_LOGIN_MAX_ATTEMPTS}.`}
                />
                <InputGroup
                  label="Account lockout duration (minutes)"
                  name="loginLockoutMinutes"
                  type="number"
                  required
                  requiredMark
                  min={MIN_LOGIN_LOCKOUT_MINUTES}
                  max={MAX_LOGIN_LOCKOUT_MINUTES}
                  value={loginLockoutMinutes === '' ? '' : String(loginLockoutMinutes)}
                  setValue={(val) => setField('loginLockoutMinutes', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description={`How long a locked account must wait. ${MIN_LOGIN_LOCKOUT_MINUTES}–${MAX_LOGIN_LOCKOUT_MINUTES} min.`}
                />
                <InputGroup
                  label="Audit log retention (days)"
                  name="activityLogRetentionDays"
                  type="number"
                  required
                  requiredMark
                  min={MIN_ACTIVITY_LOG_RETENTION_DAYS}
                  max={MAX_ACTIVITY_LOG_RETENTION_DAYS}
                  value={activityLogRetentionDays === '' ? '' : String(activityLogRetentionDays)}
                  setValue={(val) => setField('activityLogRetentionDays', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description={`System Logs older than this are deleted daily. ${MIN_ACTIVITY_LOG_RETENTION_DAYS}–${MAX_ACTIVITY_LOG_RETENTION_DAYS} days.`}
                />
                <SwitchField
                  id="allow-signup"
                  name="allow-signup"
                  label="Allow user signup"
                  checked={allowSignup}
                  onCheckedChange={(v) => setField('allowSignup', v)}
                  disabled={disabled}
                  descriptionPlacement="inline"
                  description="When enabled, the Sign up option appears on the login page."
                  boxClassName="border-black"
                />
                <InputGroup
                  label="Allowed signup email domains"
                  name="signup-allowed-domains"
                  value={signupAllowedDomains}
                  setValue={(v) => setField('signupAllowedDomains', v)}
                  disabled={disabled || !allowSignup}
                  placeholder="psu.edu, example.edu"
                  description="Restrict self-signup to these email domains (comma-separated). Leave blank to allow any domain."
                />
                <SwitchField
                  id="clock-24-hour"
                  name="clock-24-hour"
                  label="24-hour clock"
                  checked={clock24Hour}
                  onCheckedChange={(v) => setField('clock24Hour', v)}
                  disabled={disabled}
                  descriptionPlacement="inline"
                  description="Display times on a 24-hour clock (e.g. 23:59) instead of 12-hour AM/PM, app-wide."
                  boxClassName="border-black"
                />
              </div>
            </TabsContent>

            <TabsContent value="queue">
              <p className="text-muted-foreground mb-4 text-sm">
                How the autograder evaluates and rate-limits submissions.
              </p>
              <div className="max-w-md space-y-5">
                <InputGroup
                  label="Evaluation timeout (seconds)"
                  name="evalTimeoutSec"
                  type="number"
                  required
                  requiredMark
                  min={msToSec(MIN_SUBMISSION_EVAL_TIMEOUT_MS)}
                  max={msToSec(MAX_SUBMISSION_EVAL_TIMEOUT_MS)}
                  value={evalTimeoutSec === '' ? '' : String(evalTimeoutSec)}
                  setValue={(val) => setField('evalTimeoutSec', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description={`Max time per submission. ${msToSec(MIN_SUBMISSION_EVAL_TIMEOUT_MS)}–${msToSec(MAX_SUBMISSION_EVAL_TIMEOUT_MS)} s.`}
                />
                <InputGroup
                  label="Resubmit cooldown (seconds)"
                  name="resubmitCooldownSec"
                  type="number"
                  required
                  requiredMark
                  min={msToSec(MIN_SUBMISSION_RESUBMIT_COOLDOWN_MS)}
                  max={msToSec(MAX_SUBMISSION_RESUBMIT_COOLDOWN_MS)}
                  value={resubmitCooldownSec === '' ? '' : String(resubmitCooldownSec)}
                  setValue={(val) => setField('resubmitCooldownSec', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description="Wait between resubmits to a problem. 0 disables."
                />
                <InputGroup
                  label="Evaluator memory cap (MB)"
                  name="evalMaxMemoryMb"
                  type="number"
                  required
                  requiredMark
                  min={MIN_SUBMISSION_EVAL_MAX_MEMORY_MB}
                  max={MAX_SUBMISSION_EVAL_MAX_MEMORY_MB}
                  value={evalMaxMemoryMb === '' ? '' : String(evalMaxMemoryMb)}
                  setValue={(val) => setField('evalMaxMemoryMb', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description={`JVM heap per evaluation. ${MIN_SUBMISSION_EVAL_MAX_MEMORY_MB}–${MAX_SUBMISSION_EVAL_MAX_MEMORY_MB} MB.`}
                />
                <InputGroup
                  label="Max concurrent evaluations"
                  name="maxConcurrent"
                  type="number"
                  required
                  requiredMark
                  min={MIN_SUBMISSION_MAX_CONCURRENT}
                  max={MAX_SUBMISSION_MAX_CONCURRENT}
                  value={maxConcurrent === '' ? '' : String(maxConcurrent)}
                  setValue={(val) => setField('maxConcurrent', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description={`Run at once. ${MIN_SUBMISSION_MAX_CONCURRENT}–${MAX_SUBMISSION_MAX_CONCURRENT}. Applies within ~30s.`}
                />
                <InputGroup
                  label="Max retry attempts"
                  name="maxAttempts"
                  type="number"
                  required
                  requiredMark
                  min={MIN_SUBMISSION_MAX_ATTEMPTS}
                  max={MAX_SUBMISSION_MAX_ATTEMPTS}
                  value={maxAttempts === '' ? '' : String(maxAttempts)}
                  setValue={(val) => setField('maxAttempts', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description={`Retries before failing. ${MIN_SUBMISSION_MAX_ATTEMPTS}–${MAX_SUBMISSION_MAX_ATTEMPTS}.`}
                />
                <InputGroup
                  label="Analyzer exploration limit"
                  name="analyzerLimit"
                  type="number"
                  required
                  requiredMark
                  min={MIN_SUBMISSION_ANALYZER_LIMIT}
                  max={MAX_SUBMISSION_ANALYZER_LIMIT}
                  value={analyzerLimit === '' ? '' : String(analyzerLimit)}
                  setValue={(val) => setField('analyzerLimit', val === '' ? '' : Number(val))}
                  disabled={disabled}
                  description={`Depth of the cfganalyzer equivalence check. Higher is more thorough but slower. ${MIN_SUBMISSION_ANALYZER_LIMIT}–${MAX_SUBMISSION_ANALYZER_LIMIT}.`}
                />
              </div>
            </TabsContent>

            <TabsContent value="backups">
              <p className="text-muted-foreground mb-4 text-sm">
                Automatic database backups. Dumps are taken on the server and pruned after the
                retention window.
              </p>
              <div className="max-w-md space-y-5">
                <SwitchField
                  id="backup-enabled"
                  name="backup-enabled"
                  label="Enable automatic backups"
                  checked={backupEnabled}
                  onCheckedChange={(v) => setField('backupEnabled', v)}
                  disabled={disabled}
                  descriptionPlacement="inline"
                  description="When off, no scheduled dumps are taken."
                  boxClassName="border-black"
                />
                <InputGroup
                  label="Daily backup time (hour)"
                  name="backupHour"
                  type="number"
                  required
                  requiredMark
                  min={MIN_BACKUP_HOUR}
                  max={MAX_BACKUP_HOUR}
                  value={backupHour === '' ? '' : String(backupHour)}
                  setValue={(val) => setField('backupHour', val === '' ? '' : Number(val))}
                  disabled={disabled || !backupEnabled}
                  description={`24-hour clock, server time (UTC). ${MIN_BACKUP_HOUR}–${MAX_BACKUP_HOUR}. e.g. 2 = 2:00 AM.`}
                />
                <InputGroup
                  label="Retention (days)"
                  name="backupRetentionDays"
                  type="number"
                  required
                  requiredMark
                  min={MIN_BACKUP_RETENTION_DAYS}
                  max={MAX_BACKUP_RETENTION_DAYS}
                  value={backupRetentionDays === '' ? '' : String(backupRetentionDays)}
                  setValue={(val) => setField('backupRetentionDays', val === '' ? '' : Number(val))}
                  disabled={disabled || !backupEnabled}
                  description={`Older dumps are deleted. ${MIN_BACKUP_RETENTION_DAYS}–${MAX_BACKUP_RETENTION_DAYS} days.`}
                />
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                Backups are stored on the server. Copy them off-host regularly — on-host backups
                don’t survive host loss.
              </p>

              <div className="mt-6 space-y-3">
                <h3 className="text-sm font-medium">Available backups</h3>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleBackupNow}
                  disabled={disabled || backupNowBusy}
                >
                  {backupNowBusy ? 'Requesting…' : 'Back up now'}
                </Button>

                {backupsLoading ? (
                  <p className="text-muted-foreground text-sm">Loading…</p>
                ) : backups.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No backups yet.</p>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm" aria-label="Available backups">
                      <thead className="bg-muted/30 text-left">
                        <tr>
                          <th scope="col" className="p-2 font-medium">
                            Taken (server time)
                          </th>
                          <th scope="col" className="p-2 font-medium">
                            Database
                          </th>
                          <th scope="col" className="p-2 font-medium">
                            Files
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {backups.map((b) => (
                          <tr key={b.timestamp} className="border-t">
                            <td className="p-2 whitespace-nowrap">{formatBackupTs(b.timestamp)}</td>
                            <td className="p-2">
                              {b.dumpFile ? (
                                <a
                                  className="text-sky-600 underline"
                                  href={apiPaths.admin.backupDownload({ file: b.dumpFile })}
                                >
                                  Download ({formatBytes(b.dumpSize)})
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="p-2">
                              {b.filesFile ? (
                                <a
                                  className="text-sky-600 underline"
                                  href={apiPaths.admin.backupDownload({ file: b.filesFile })}
                                >
                                  Download ({formatBytes(b.filesSize)})
                                </a>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-muted-foreground text-xs">
                  Download both the database and files from the same row to keep a complete,
                  restorable copy off-host.
                </p>
              </div>
            </TabsContent>

            <TabsContent value="updates">
              <p className="text-muted-foreground mb-4 text-sm">
                Upgrade AFCT to a newer published release. The stack backs up the
                database first, downloads the new version, and restarts; if the new
                version fails its health check it is rolled back automatically.
              </p>

              <div className="max-w-2xl space-y-5">
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Current version</h3>
                  <Badge variant="secondary" className="w-fit font-mono">
                    {upgradeLoading && !upgradeInfo ? 'Loading…' : (upgradeInfo?.current ?? 'unknown')}
                  </Badge>
                </div>

                {upgradeInfo?.status?.phase && (
                  <div className="space-y-2" ref={upgradeStatusRef} tabIndex={-1}>
                    <h3 className="text-sm font-medium">Update status</h3>
                    {/* role="status": phase changes arrive via background polling,
                        so announce them to screen readers as they happen. */}
                    <div
                      role="status"
                      className="bg-muted/10 w-fit max-w-xl space-y-2 rounded-md border p-3 text-sm"
                    >
                      <Badge
                        variant={
                          upgradeInfo.status.phase === 'healthy'
                            ? 'success'
                            : upgradeInfo.status.phase === 'failed'
                              ? 'destructive'
                              : upgradeInfo.status.phase === 'rolled_back'
                                ? 'warning'
                                : 'secondary'
                        }
                        className="w-fit"
                      >
                        {upgradePhaseLabel(upgradeInfo.status.phase)}
                      </Badge>
                      {upgradeInfo.status.message && (
                        <p className="text-muted-foreground">{upgradeInfo.status.message}</p>
                      )}
                      {upgradeInProgress && (
                        <p className="text-muted-foreground text-xs">
                          This can take a few minutes; the site may briefly restart.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {upgradeInfo?.manifestError ? (
                  <p className="text-muted-foreground text-sm">
                    The list of available versions could not be loaded. Check the
                    server’s network access and reopen this tab to retry.
                  </p>
                ) : upgradeableVersions.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {upgradeLoading
                      ? 'Loading available versions…'
                      : 'AFCT is on the latest available version.'}
                  </p>
                ) : (
                  <div className="space-y-3">
                    <SelectField
                      label="Upgrade to"
                      name="upgradeVersion"
                      id="upgradeVersion"
                      placeholder="Select a version"
                      value={selectedVersion}
                      onValueChange={setSelectedVersion}
                      disabled={disabled || upgradeBusy || upgradeInProgress}
                      options={upgradeableVersions.map((v) => ({
                        value: v.tag,
                        label: v.label && v.label !== v.tag ? `${v.label} (${v.tag})` : v.tag,
                      }))}
                      triggerClassName="border-black"
                    />
                    {selectedVersionInfo?.notes && (
                      <p className="text-muted-foreground text-sm">{selectedVersionInfo.notes}</p>
                    )}
                    {selectedVersionInfo?.requiresHostUpdate && (
                      <div
                        role="note"
                        className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                      >
                        This release also updates a component the in-app upgrade can’t
                        replace on its own. After the upgrade finishes, run{' '}
                        <code className="font-mono">sh install.sh update</code> on the
                        server to complete it.
                      </div>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => setConfirmUpgradeOpen(true)}
                      disabled={disabled || upgradeBusy || upgradeInProgress || !selectedVersion}
                    >
                      {upgradeBusy || upgradeInProgress ? 'Upgrading…' : 'Upgrade…'}
                    </Button>
                  </div>
                )}
              </div>

              <Dialog open={confirmUpgradeOpen} onOpenChange={setConfirmUpgradeOpen}>
                <DialogContent
                  className="bg-card sm:max-w-lg"
                  onCloseAutoFocus={(e) => {
                    // Once the upgrade starts, the button that opened this dialog is
                    // disabled, so the default focus return would drop to <body>.
                    if ((upgradeBusy || upgradeInProgress) && upgradeStatusRef.current) {
                      e.preventDefault();
                      upgradeStatusRef.current.focus();
                    }
                  }}
                >
                  <DialogHeader>
                    <DialogTitle>Upgrade AFCT?</DialogTitle>
                    <DialogDescription>
                      AFCT will upgrade from{' '}
                      <span className="font-mono">{upgradeInfo?.current}</span> to{' '}
                      <span className="font-mono">{selectedVersion}</span>. It backs up
                      the database first, downloads the new version, and restarts. This
                      may take a few minutes, during which the site may be briefly
                      unavailable. A failed upgrade is rolled back automatically.
                    </DialogDescription>
                    {selectedVersionInfo?.requiresHostUpdate && (
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                        Afterward, run <code className="font-mono">sh install.sh update</code>{' '}
                        on the server to finish updating a component the app can’t replace
                        itself.
                      </p>
                    )}
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmUpgradeOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      onClick={() => {
                        startUpgrade(selectedVersion);
                        setConfirmUpgradeOpen(false);
                      }}
                    >
                      Upgrade
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Restore / downgrade — destructive, so kept visually separate. */}
              {restorePoints.length > 0 && (
                <div className="mt-8 max-w-2xl space-y-3 border-t pt-6">
                  <h3 className="text-destructive text-sm font-semibold">
                    Restore a previous version
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    Downgrading restores the database backup taken before that version was
                    replaced. It{' '}
                    <span className="text-destructive font-medium">
                      permanently discards everything created since that backup
                    </span>{' '}
                    — submissions, grades, and accounts. Use this only for recovery.
                  </p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm" aria-label="Restore points">
                      <thead className="bg-muted/30 text-left">
                        <tr>
                          <th scope="col" className="p-2 font-medium">
                            Version
                          </th>
                          <th scope="col" className="p-2 font-medium">
                            Backup taken
                          </th>
                          <th scope="col" className="p-2 font-medium">
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {restorePoints.map((r) => (
                          <tr key={r.backup} className="border-t">
                            <td className="p-2 font-mono whitespace-nowrap">{r.version}</td>
                            <td className="p-2 whitespace-nowrap">{formatBackupTs(r.backup)}</td>
                            <td className="p-2 text-right">
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                aria-label={`Restore version ${r.version}`}
                                disabled={disabled || downgradeBusy || upgradeInProgress}
                                onClick={() => {
                                  setRestoreTarget({ version: r.version, backup: r.backup });
                                  setRestoreConfirmText('');
                                }}
                              >
                                Restore
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <Dialog
                open={restoreTarget !== null}
                onOpenChange={(open) => {
                  if (!open) setRestoreTarget(null);
                }}
              >
                <DialogContent
                  className="bg-card sm:max-w-lg"
                  onCloseAutoFocus={(e) => {
                    // Same as the upgrade dialog: the row's Restore button is disabled
                    // once the downgrade starts, so send focus to the status panel.
                    if ((downgradeBusy || upgradeInProgress) && upgradeStatusRef.current) {
                      e.preventDefault();
                      upgradeStatusRef.current.focus();
                    }
                  }}
                >
                  <DialogHeader>
                    <DialogTitle className="text-destructive">
                      Restore and downgrade to {restoreTarget?.version}?
                    </DialogTitle>
                    <DialogDescription>
                      This restores the database backup from{' '}
                      <span className="font-mono">
                        {restoreTarget ? formatBackupTs(restoreTarget.backup) : ''}
                      </span>{' '}
                      and runs{' '}
                      <span className="font-mono">{restoreTarget?.version}</span>. Everything
                      created since that backup — submissions, grades, accounts — is{' '}
                      <span className="text-destructive font-medium">permanently lost</span>.
                      A safety backup of the current state is taken first. Type{' '}
                      <span className="font-mono">{restoreTarget?.version}</span> to confirm.
                    </DialogDescription>
                  </DialogHeader>
                  <InputGroup
                    label="Confirm version"
                    name="restoreConfirm"
                    // Carried on the field itself (aria-describedby) so screen-reader
                    // users can re-query what to type without re-reading the dialog.
                    description={`Type ${restoreTarget?.version ?? ''} to enable the restore button.`}
                    value={restoreConfirmText}
                    setValue={(v) => setRestoreConfirmText(v)}
                    disabled={downgradeBusy}
                  />
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setRestoreTarget(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={downgradeBusy || restoreConfirmText !== restoreTarget?.version}
                      onClick={() => {
                        if (restoreTarget) {
                          startDowngrade({
                            tag: restoreTarget.version,
                            restorePoint: restoreTarget.backup,
                          });
                        }
                        setRestoreTarget(null);
                      }}
                    >
                      Restore and downgrade
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </TabsContent>

            <TabsContent value="captcha">
              <p className="text-muted-foreground mb-4 text-sm">
                Optional bot protection, shown as a challenge after repeated failed logins.
              </p>

              {/* Current status */}
              <div className="mb-5 space-y-2">
                <h3 className="text-sm font-medium">Current status</h3>
                <div className="bg-muted/10 w-fit max-w-2xl space-y-2 rounded-md border p-3 text-sm">
                  <Badge variant={hcaptchaEnabled ? 'success' : 'warning'} className="w-fit">
                    {hcaptchaEnabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                  <p className="text-muted-foreground">
                    {hcaptchaEnabled
                      ? 'Bot protection is on. After repeated failed logins, users are shown an hCaptcha challenge.'
                      : 'Bot protection is off. Add your hCaptcha keys below to turn it on.'}
                  </p>
                </div>
              </div>

              <div className="max-w-md space-y-5">
                <InputGroup
                  label="hCaptcha site key"
                  name="hcaptchaSiteKey"
                  value={hcaptchaSiteKey}
                  setValue={(v) => setField('hcaptchaSiteKey', v)}
                  disabled={disabled}
                  description="Public key. Leave blank to disable."
                />
                <InputGroup
                  label="hCaptcha secret key"
                  name="hcaptchaSecretKey"
                  type="password"
                  showEye
                  value={hcaptchaSecretKey}
                  setValue={setHcaptchaSecretKey}
                  disabled={disabled || hcaptchaSecretClear}
                  placeholder={
                    hcaptchaSecretConfigured ? 'Saved — leave blank to keep' : 'Enter secret key'
                  }
                  description="Private key. Stored securely, never shown again."
                />
                {hcaptchaSecretConfigured && (
                  <SwitchField
                    id="hcaptcha-secret-clear"
                    name="hcaptcha-secret-clear"
                    label="Remove saved secret key"
                    checked={hcaptchaSecretClear}
                    onCheckedChange={setHcaptchaSecretClear}
                    disabled={disabled}
                    descriptionPlacement="inline"
                    description="Deletes the stored secret when you save."
                  />
                )}
              </div>
              <p className="text-muted-foreground mt-3 text-xs">
                To get keys, sign up at{' '}
                <a
                  href="https://www.hcaptcha.com/signup"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  hcaptcha.com
                </a>{' '}
                and copy your site key and secret key. Leave both keys blank to keep hCaptcha off.
              </p>
            </TabsContent>

            <TabsContent value="tls">
              <p className="text-muted-foreground mb-4 text-sm">
                The certificate the server presents over HTTPS.
              </p>

              <div className="space-y-5">
                {/* Current status */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Current certificate</h3>
                  <div className="bg-muted/10 w-fit max-w-2xl space-y-2 rounded-md border p-3 text-sm">
                    {tls?.installed ? (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          {tls.expired ? (
                            <Badge variant="warning">Expired</Badge>
                          ) : tls.selfSigned ? (
                            <Badge variant="warning">Self-signed certificate</Badge>
                          ) : (
                            <Badge variant="success">Trusted certificate</Badge>
                          )}
                        </div>
                        {tls.subject && (
                          <div className="text-foreground break-all">
                            <span className="text-muted-foreground">Issued to: </span>
                            {tls.subject}
                          </div>
                        )}
                        {tls.validTo && (
                          <div className="text-foreground">
                            <span className="text-muted-foreground">Valid until: </span>
                            {tls.validTo}
                          </div>
                        )}
                        <p className="text-muted-foreground">
                          {tls.expired
                            ? 'This certificate has expired, so browsers will show a security warning until you install a valid one.'
                            : tls.selfSigned
                              ? 'This certificate isn’t issued by a trusted authority, so browsers will show a security warning.'
                              : 'This certificate is trusted by browsers, so visitors won’t see a security warning.'}
                        </p>
                      </>
                    ) : (
                      <>
                        <Badge variant="warning" className="w-fit">
                          Self-signed (built-in)
                        </Badge>
                        <p className="text-foreground">
                          The server is using its built-in self-signed certificate.
                        </p>
                        <p className="text-muted-foreground">
                          The connection is still encrypted, but browsers will show a security
                          warning until you install a trusted certificate below.
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {/* A CSR was generated but its signed cert isn't installed yet. */}
                {tls?.pendingCsr && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="warning">CSR pending</Badge>
                    <span className="text-muted-foreground">
                      A request is waiting for its signed certificate.
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setTlsMethod('csr')}
                    >
                      Finish CSR
                    </Button>
                  </div>
                )}

                {/* Method chooser */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Set up a certificate</h3>
                  <div
                    className="flex flex-wrap gap-2"
                    role="group"
                    aria-label="Certificate setup method"
                  >
                    <Button type="button" size="sm" onClick={() => setTlsMethod('csr')}>
                      Request a CA-signed certificate
                    </Button>
                    <Button type="button" size="sm" onClick={() => setTlsMethod('self-signed')}>
                      Create a self-signed certificate
                    </Button>
                    <Button type="button" size="sm" onClick={() => setTlsMethod('upload')}>
                      Upload an existing certificate
                    </Button>
                  </div>
                </div>

                {/* Generate CSR / self-signed hostname form (modal) */}
                <Dialog
                  open={tlsMethod === 'csr' || tlsMethod === 'self-signed'}
                  onOpenChange={(open) => {
                    if (!open) setTlsMethod(null);
                  }}
                >
                  <DialogContent className="bg-card sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>
                        {tlsMethod === 'csr'
                          ? 'Request a CA-signed certificate'
                          : 'Create a self-signed certificate'}
                      </DialogTitle>
                      <DialogDescription>
                        {tlsMethod === 'csr'
                          ? 'Enter your hostname and generate a CSR to send to your certificate authority. The private key is created and kept on the server.'
                          : 'Generate a self-signed certificate for this hostname — no certificate authority needed (browsers still warn unless trusted internally).'}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-5">
                      <InputGroup
                        label="Hostname (Common Name)"
                        name="csrCommonName"
                        requiredMark
                        placeholder="afct.example.edu"
                        value={csrCommonName}
                        setValue={setCsrCommonName}
                        disabled={tlsBusy}
                        description="The DNS name (or IP) the server is reached at."
                      />
                      <InputGroup
                        label="Organization (optional)"
                        name="csrOrganization"
                        placeholder="Penn State Wilkes-Barre"
                        value={csrOrganization}
                        setValue={setCsrOrganization}
                        disabled={tlsBusy}
                        description="Your school or organization name, included in the certificate."
                      />
                      <InputGroup
                        label="Additional hostnames / SANs (optional)"
                        name="csrAltNames"
                        placeholder="www.example.edu, 10.0.0.5"
                        value={csrAltNames}
                        setValue={setCsrAltNames}
                        disabled={tlsBusy}
                        description="Comma-separated extra DNS names or IPs."
                      />
                    </div>

                    {tlsMethod === 'csr' && tls?.pendingCsr && (
                      <div className="bg-muted/30 space-y-3 rounded-md border p-3">
                        <p className="text-sm">
                          CSR generated (<span className="font-mono text-xs">afct.csr</span>).
                          Upload the signed certificate from your CA:
                        </p>
                        <div className="space-y-4">
                          <FileUploadInput
                            id="tls-signed-cert"
                            name="tls-signed-cert"
                            label="Signed certificate (PEM)"
                            accept=".crt,.pem,.cer"
                            maxSizeMb={5}
                            disabled={tlsBusy}
                            value={signedCertFile ?? undefined}
                            onChange={(f) => setSignedCertFile(f ?? null)}
                          />
                          <FileUploadInput
                            id="tls-signed-chain"
                            name="tls-signed-chain"
                            label="Chain / intermediates (optional)"
                            accept=".crt,.pem,.cer"
                            maxSizeMb={5}
                            disabled={tlsBusy}
                            value={signedChainFile ?? undefined}
                            onChange={(f) => setSignedChainFile(f ?? null)}
                          />
                        </div>
                        <Button
                          type="button"
                          onClick={installSignedCert}
                          disabled={tlsBusy || !signedCertFile}
                        >
                          Install signed certificate
                        </Button>
                      </div>
                    )}

                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setTlsMethod(null)}
                        disabled={tlsBusy}
                      >
                        Cancel
                      </Button>
                      {tlsMethod === 'csr' ? (
                        <Button type="button" onClick={generateCsr} disabled={tlsBusy || cnMissing}>
                          {tlsBusy ? 'Working…' : 'Generate key & CSR'}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={generateSelfSigned}
                          disabled={tlsBusy || cnMissing}
                        >
                          {tlsBusy ? 'Working…' : 'Generate self-signed certificate'}
                        </Button>
                      )}
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Upload existing cert + key (modal) */}
                <Dialog
                  open={tlsMethod === 'upload'}
                  onOpenChange={(open) => {
                    if (!open) setTlsMethod(null);
                  }}
                >
                  <DialogContent className="bg-card sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>Upload an existing certificate</DialogTitle>
                      <DialogDescription>
                        Upload a certificate and its matching private key (PEM).
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      <FileUploadInput
                        id="tls-cert"
                        name="tls-cert"
                        label="Certificate (PEM)"
                        accept=".crt,.pem,.cer"
                        maxSizeMb={5}
                        disabled={tlsBusy}
                        value={certFile ?? undefined}
                        onChange={(f) => setCertFile(f ?? null)}
                      />
                      <FileUploadInput
                        id="tls-key"
                        name="tls-key"
                        label="Private key (PEM)"
                        accept=".key,.pem"
                        maxSizeMb={5}
                        disabled={tlsBusy}
                        value={keyFile ?? undefined}
                        onChange={(f) => setKeyFile(f ?? null)}
                      />
                      <FileUploadInput
                        id="tls-chain"
                        name="tls-chain"
                        label="Chain / intermediates (optional)"
                        accept=".crt,.pem,.cer"
                        maxSizeMb={5}
                        disabled={tlsBusy}
                        value={chainFile ?? undefined}
                        onChange={(f) => setChainFile(f ?? null)}
                      />
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setTlsMethod(null)}
                        disabled={tlsBusy}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={applyCert}
                        disabled={tlsBusy || !certFile || !keyFile}
                      >
                        {tlsBusy ? 'Applying…' : 'Apply certificate'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                {/* Footer note + reset */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-muted-foreground max-w-xl text-xs">
                    The new certificate takes effect within about 15 seconds. If the new certificate
                    is invalid, it’s rejected and the current one is kept in place, so the site
                    stays reachable.
                  </p>
                  {tls?.installed && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={resetCert}
                      disabled={tlsBusy}
                    >
                      Reset to self-signed
                    </Button>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Save action, bottom-right of the card. */}
          <div className="mt-6 flex items-center justify-start gap-3 border-t pt-4">
            <Button
              type="submit"
              form="system-settings-form"
              size="sm"
              aria-label="Save system settings"
              disabled={disabled}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
            {isDirty && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetForm}
                disabled={saving}
              >
                Reset
              </Button>
            )}
            {isDirty && <span className="text-muted-foreground text-sm">Unsaved changes</span>}
          </div>
        </CardContent>
      </Card>

      {/* The settings inputs live outside a <form> element, so this empty form
          gives the sticky Save button something to submit via form=. */}
      <form id="system-settings-form" onSubmit={onSubmit} className="hidden" aria-hidden="true" />
    </div>
  );
}
