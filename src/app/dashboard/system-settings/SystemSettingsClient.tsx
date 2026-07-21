'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
} from '@/lib/system-settings';
import { parseDomainList } from '@/lib/email';
import { SystemSettingsUpdateSchema } from '@/schemas/systemSettings';
import { SlidersHorizontal, Cpu, DatabaseBackup, ShieldCheck, Lock, RefreshCw } from 'lucide-react';
import {
  buildSettingsSnapshot,
  formReducer,
  msToSec,
  secToMs,
  EMPTY_FORM,
  SETTINGS_TAB_KEY,
  SETTINGS_TABS,
  type SystemSettingsResponse,
  type FormSnapshot,
  type FormAction,
} from './system-settings-shared';
import { GeneralTab } from './GeneralTab';
import { EvaluatorTab } from './EvaluatorTab';
import { BackupsTab } from './BackupsTab';
import { CaptchaTab } from './CaptchaTab';
import { TlsTab } from './TlsTab';
import { UpdatesTab } from './UpdatesTab';

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
  // The ~19 Save-covered fields live in one reducer-managed object. `setField` is the
  // typed single-field updater the field JSX calls; a whole-object `reset` seeds/restores
  // the form (on load, Cancel, and after save).
  const [form, dispatchForm] = useReducer(formReducer, initialSeed ?? EMPTY_FORM);
  const setField = useCallback(<K extends keyof FormSnapshot>(field: K, value: FormSnapshot[K]) => {
    dispatchForm({ type: 'set', field, value } as FormAction);
  }, []);

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

  // hCaptcha secret is write-only (we only know whether one is set), so it stays local
  // here (the site key is part of the form object). These feed Save, the dirty-check,
  // and the enabled state, so they live in the parent and pass down to the Captcha tab.
  const [hcaptchaSecretKey, setHcaptchaSecretKey] = useState('');
  const [hcaptchaSecretConfigured, setHcaptchaSecretConfigured] = useState(() =>
    Boolean(settingsData?.hcaptchaSecretConfigured),
  );
  const [hcaptchaSecretClear, setHcaptchaSecretClear] = useState(false);

  // Baseline of saved values, for unsaved-changes detection. Seeded synchronously
  // on a warm cache so `loading` (below) is false immediately: no disabled flash.
  const [baseline, setBaseline] = useState<FormSnapshot | null>(initialSeed);

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

    const clampedSize = Math.max(1, Math.min(50, Math.trunc(Number(maxUploadSizeMb) || 0)));
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

  // `form` is the current snapshot; compare it to the saved baseline for the dirty state.
  const isDirty =
    !!baseline &&
    (JSON.stringify(form) !== JSON.stringify(baseline) ||
      hcaptchaSecretKey.trim() !== '' ||
      hcaptchaSecretClear);

  const hcaptchaEnabled =
    hcaptchaSiteKey.trim() !== '' ||
    hcaptchaSecretKey.trim() !== '' ||
    (hcaptchaSecretConfigured && !hcaptchaSecretClear);

  const triggerClass =
    'hover:bg-accent data-[state=active]:bg-secondary px-4 whitespace-nowrap data-[state=active]:text-white';

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
              <TabsTrigger value="general" className={triggerClass}>
                <SlidersHorizontal aria-hidden="true" />
                General
              </TabsTrigger>
              <TabsTrigger value="queue" className={triggerClass}>
                <Cpu aria-hidden="true" />
                Evaluator
              </TabsTrigger>
              <TabsTrigger value="backups" className={triggerClass}>
                <DatabaseBackup aria-hidden="true" />
                Backups
              </TabsTrigger>
              <TabsTrigger value="captcha" className={triggerClass}>
                <ShieldCheck aria-hidden="true" />
                Captcha
              </TabsTrigger>
              <TabsTrigger value="tls" className={triggerClass}>
                <Lock aria-hidden="true" />
                TLS Certificate
              </TabsTrigger>
              <TabsTrigger value="updates" className={triggerClass}>
                <RefreshCw aria-hidden="true" />
                Updates
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general">
              <GeneralTab
                form={form}
                setField={setField}
                disabled={disabled}
                loading={loading}
                configuredUrl={settingsData?.configuredUrl}
                timezoneOptions={timezoneOptions}
              />
            </TabsContent>

            <TabsContent value="queue">
              <EvaluatorTab form={form} setField={setField} disabled={disabled} />
            </TabsContent>

            <TabsContent value="backups">
              <BackupsTab form={form} setField={setField} disabled={disabled} />
            </TabsContent>

            <TabsContent value="captcha">
              <CaptchaTab
                siteKey={hcaptchaSiteKey}
                setField={setField}
                disabled={disabled}
                secretKey={hcaptchaSecretKey}
                setSecretKey={setHcaptchaSecretKey}
                secretConfigured={hcaptchaSecretConfigured}
                secretClear={hcaptchaSecretClear}
                setSecretClear={setHcaptchaSecretClear}
                hcaptchaEnabled={hcaptchaEnabled}
                savedSiteKey={settingsData?.hcaptchaSiteKey}
              />
            </TabsContent>

            <TabsContent value="tls">
              <TlsTab configuredUrl={settingsData?.configuredUrl} />
            </TabsContent>

            <TabsContent value="updates">
              <UpdatesTab disabled={disabled} />
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
              <Button type="button" variant="outline" size="sm" onClick={resetForm} disabled={saving}>
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
