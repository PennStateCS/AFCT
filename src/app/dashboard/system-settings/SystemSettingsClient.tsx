'use client';

import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TabBar } from '@/components/course/course-tabs';
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
import {
  SlidersHorizontal,
  Cpu,
  DatabaseBackup,
  LogIn,
  Mail,
  ShieldCheck,
  Lock,
  RefreshCw,
} from 'lucide-react';
import {
  buildSettingsSnapshot,
  formReducer,
  msToSec,
  secToMs,
  EMPTY_FORM,
  SETTINGS_TAB_KEY,
  SETTINGS_TABS,
  describeSettingsIssue,
  type SystemSettingsResponse,
  type FormSnapshot,
  type FormAction,
} from './system-settings-shared';
import { DEFAULT_SMTP_PORT } from '@/lib/system-settings';
import { GeneralTab } from './GeneralTab';
import { EmailTab } from './EmailTab';
import { SignInTab } from './SignInTab';
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
    smtpEnabled,
    smtpHost,
    smtpPort,
    smtpSecurity,
    smtpUsername,
    smtpFromAddress,
    smtpFromName,
    oidcEnabled,
    oidcIssuer,
    oidcClientId,
    oidcButtonLabel,
    oidcTrustEmail,
  } = form;

  // hCaptcha secret is write-only (we only know whether one is set), so it stays local
  // here (the site key is part of the form object). These feed Save, the dirty-check,
  // and the enabled state, so they live in the parent and pass down to the Captcha tab.
  const [hcaptchaSecretKey, setHcaptchaSecretKey] = useState('');
  const [hcaptchaSecretConfigured, setHcaptchaSecretConfigured] = useState(() =>
    Boolean(settingsData?.hcaptchaSecretConfigured),
  );
  const [hcaptchaSecretClear, setHcaptchaSecretClear] = useState(false);

  // The mail password is write-only for the same reason as the hCaptcha secret: the server
  // only ever tells us whether one is stored.
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpPasswordConfigured, setSmtpPasswordConfigured] = useState(() =>
    Boolean(settingsData?.smtpPasswordConfigured),
  );
  const [smtpPasswordClear, setSmtpPasswordClear] = useState(false);

  // The OIDC client secret is write-only for the same reason as the two above.
  const [oidcClientSecret, setOidcClientSecret] = useState('');
  const [oidcClientSecretConfigured, setOidcClientSecretConfigured] = useState(() =>
    Boolean(settingsData?.oidcClientSecretConfigured),
  );
  const [oidcClientSecretClear, setOidcClientSecretClear] = useState(false);

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
    setSmtpPasswordConfigured(Boolean(settingsData.smtpPasswordConfigured));
    setSmtpPassword('');
    setSmtpPasswordClear(false);
    setOidcClientSecretConfigured(Boolean(settingsData.oidcClientSecretConfigured));
    setOidcClientSecret('');
    setOidcClientSecretClear(false);
    setBaseline(norm);
  }, [settingsData, baseline]);

  // Surface a load failure the same way the imperative fetch did.
  useEffect(() => {
    if (settingsError)
      showToast.error('Could not load system settings. Refresh the page to try again.');
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
    // The field can be emptied while typing; fall back rather than sending NaN.
    const smtpPortValue = Number(smtpPort) || DEFAULT_SMTP_PORT;
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
      smtpEnabled,
      smtpHost: smtpHost.trim(),
      smtpPort: smtpPortValue,
      smtpSecurity,
      smtpUsername: smtpUsername.trim(),
      smtpFromAddress: smtpFromAddress.trim(),
      smtpFromName: smtpFromName.trim(),
      // Same write-only rule as the hCaptcha secret: send nothing to keep what is stored.
      ...(smtpPasswordClear
        ? { smtpPasswordClear: true }
        : smtpPassword.trim()
          ? { smtpPassword: smtpPassword.trim() }
          : {}),
      oidcEnabled,
      oidcIssuer: oidcIssuer.trim(),
      oidcClientId: oidcClientId.trim(),
      oidcButtonLabel: oidcButtonLabel.trim(),
      oidcTrustEmail,
      ...(oidcClientSecretClear
        ? { oidcClientSecretClear: true }
        : oidcClientSecret.trim()
          ? { oidcClientSecret: oidcClientSecret.trim() }
          : {}),
    });
    if (!parsedSettings.success) {
      const issue = parsedSettings.error.issues[0];
      showToast.error(
        issue ? describeSettingsIssue(issue) : 'Please review the settings and try again.',
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
        smtpEnabled,
        smtpHost: smtpHost.trim(),
        smtpPort,
        smtpSecurity,
        smtpUsername: smtpUsername.trim(),
        smtpFromAddress: smtpFromAddress.trim(),
        smtpFromName: smtpFromName.trim(),
        oidcEnabled,
        oidcIssuer: oidcIssuer.trim(),
        oidcClientId: oidcClientId.trim(),
        oidcButtonLabel: oidcButtonLabel.trim(),
        oidcTrustEmail,
      };
      dispatchForm({ type: 'reset', snapshot: savedSnapshot });
      setBaseline(savedSnapshot);
      setHcaptchaSecretConfigured(
        hcaptchaSecretClear ? false : hcaptchaSecretKey.trim() ? true : hcaptchaSecretConfigured,
      );
      setOidcClientSecretConfigured(
        oidcClientSecretClear
          ? false
          : oidcClientSecret.trim()
            ? true
            : oidcClientSecretConfigured,
      );
      setOidcClientSecret('');
      setOidcClientSecretClear(false);
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
              smtpEnabled,
              smtpHost: smtpHost.trim(),
              smtpPort: smtpPortValue,
              smtpSecurity,
              smtpUsername: smtpUsername.trim(),
              smtpFromAddress: smtpFromAddress.trim(),
              smtpFromName: smtpFromName.trim(),
              oidcEnabled,
              oidcIssuer: oidcIssuer.trim(),
              oidcClientId: oidcClientId.trim(),
              oidcButtonLabel: oidcButtonLabel.trim(),
              oidcTrustEmail,
              oidcClientSecretConfigured: oidcClientSecretClear
                ? false
                : oidcClientSecret.trim() !== '' || oidcClientSecretConfigured,
              // A password that was just set is now stored; a cleared one is not.
              smtpPasswordConfigured: smtpPasswordClear
                ? false
                : smtpPassword.trim() !== '' || smtpPasswordConfigured,
              hcaptchaSecretConfigured: hcaptchaSecretClear
                ? false
                : hcaptchaSecretKey.trim()
                  ? true
                  : prev.hcaptchaSecretConfigured,
            }
          : prev,
      );
      showToast.updated('System settings');
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

  // Single source of truth for the tab strip and its mobile select fallback, so the
  // two never drift apart.
  const settingsTabs = [
    { value: 'general', label: 'General', Icon: SlidersHorizontal },
    { value: 'queue', label: 'Evaluator', Icon: Cpu },
    { value: 'backups', label: 'Backups', Icon: DatabaseBackup },
    { value: 'email', label: 'Email', Icon: Mail },
    { value: 'sign-in', label: 'Sign-in', Icon: LogIn },
    { value: 'captcha', label: 'Captcha', Icon: ShieldCheck },
    { value: 'tls', label: 'TLS Certificate', Icon: Lock },
    { value: 'updates', label: 'Updates', Icon: RefreshCw },
  ] as const;

  // The TLS and Updates tabs have no fields covered by the shared Save; they drive
  // their own actions (issue a certificate, run an upgrade). Hiding the Save/Reset row
  // there keeps it from looking like those tabs have unsaved settings. Every other tab,
  // Backups included (its schedule is part of the form), needs it.
  const showSave = tab !== 'tls' && tab !== 'updates';

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
            <TabBar
              ariaLabel="System settings sections"
              selectId="system-settings-tab-select"
              value={tab}
              onValueChange={handleTabChange}
              tabs={settingsTabs}
            />

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

            <TabsContent value="email">
              <EmailTab
                enabled={smtpEnabled}
                host={smtpHost}
                port={typeof smtpPort === 'number' ? smtpPort : DEFAULT_SMTP_PORT}
                security={smtpSecurity}
                username={smtpUsername}
                fromAddress={smtpFromAddress}
                fromName={smtpFromName}
                setField={setField}
                disabled={disabled}
                password={smtpPassword}
                setPassword={setSmtpPassword}
                passwordConfigured={smtpPasswordConfigured}
                passwordClear={smtpPasswordClear}
                setPasswordClear={setSmtpPasswordClear}
                savedHost={settingsData?.smtpHost}
                dirty={isDirty}
              />
            </TabsContent>

            <TabsContent value="sign-in">
              <SignInTab
                enabled={oidcEnabled}
                issuer={oidcIssuer}
                clientId={oidcClientId}
                buttonLabel={oidcButtonLabel}
                trustEmail={oidcTrustEmail}
                setField={setField}
                disabled={disabled}
                clientSecret={oidcClientSecret}
                setClientSecret={setOidcClientSecret}
                clientSecretConfigured={oidcClientSecretConfigured}
                clientSecretClear={oidcClientSecretClear}
                setClientSecretClear={setOidcClientSecretClear}
                // Derived from the site URL the installer set, so an admin can hand it to IT
                // without guessing at the path.
                redirectUri={`${(settingsData?.configuredUrl ?? '').replace(/\/+$/, '')}/api/auth/callback/oidc`}
              />
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

          {/* Save action, bottom-left of the card. Hidden on tabs with no savable
              fields (TLS, Updates), which run their own actions instead. */}
          {showSave && (
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
          )}
        </CardContent>
      </Card>

      {/* The settings inputs live outside a <form> element, so this empty form
          gives the sticky Save button something to submit via form=. */}
      <form id="system-settings-form" onSubmit={onSubmit} className="hidden" aria-hidden="true" />
    </div>
  );
}
