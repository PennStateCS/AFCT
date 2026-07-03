'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { showToast } from '@/lib/toast';
import { COMMON_TIMEZONES, formatTimezoneLabel } from '@/lib/timezones';
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
} from '@/lib/system-settings';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import SwitchField from '@/components/ui/SwitchField';
import FileUploadInput from '@/components/FileUploadInput';

type SystemSettingsResponse = {
  timezone: string;
  maxUploadSizeMb: number;
  allowSignup: boolean;
  sessionTimeoutMinutes: number;
  submissionEvalTimeoutMs: number;
  submissionEvalMaxMemoryMb: number;
  submissionResubmitCooldownMs: number;
  submissionMaxConcurrent: number;
  submissionMaxAttempts: number;
  submissionAnalyzerLimit: number;
  hcaptchaSiteKey: string;
  hcaptchaSecretConfigured: boolean;
};

type TlsInfo = {
  installed: boolean;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  selfSigned?: boolean;
  expired?: boolean;
  pendingCsr?: boolean;
};

// Fields covered by the main Save (used for unsaved-changes tracking).
type FormSnapshot = {
  timezone: string;
  maxUploadSizeMb: number | '';
  allowSignup: boolean;
  sessionTimeoutMinutes: number | '';
  evalTimeoutSec: number | '';
  resubmitCooldownSec: number | '';
  evalMaxMemoryMb: number | '';
  maxConcurrent: number | '';
  maxAttempts: number | '';
  analyzerLimit: number | '';
  hcaptchaSiteKey: string;
};

type TlsMethod = 'csr' | 'self-signed' | 'upload' | null;

const msToSec = (ms: number) => Math.round(ms / 1000);
const secToMs = (sec: number) => Math.round(sec * 1000);

const SETTINGS_TAB_KEY = 'afct.systemSettingsTab';
const SETTINGS_TABS = ['general', 'queue', 'captcha', 'tls'];

export default function SystemSettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('general');
  const [timezone, setTimezone] = useState('');
  const [maxUploadSizeMb, setMaxUploadSizeMb] = useState<number | ''>('');
  const [allowSignup, setAllowSignup] = useState(true);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState<number | ''>('');

  // Queue settings — durations held in seconds for display.
  const [evalTimeoutSec, setEvalTimeoutSec] = useState<number | ''>('');
  const [resubmitCooldownSec, setResubmitCooldownSec] = useState<number | ''>('');
  const [evalMaxMemoryMb, setEvalMaxMemoryMb] = useState<number | ''>('');
  const [maxConcurrent, setMaxConcurrent] = useState<number | ''>('');
  const [maxAttempts, setMaxAttempts] = useState<number | ''>('');
  const [analyzerLimit, setAnalyzerLimit] = useState<number | ''>('');

  // hCaptcha keys. The secret is write-only: we only know whether one is set.
  const [hcaptchaSiteKey, setHcaptchaSiteKey] = useState('');
  const [hcaptchaSecretKey, setHcaptchaSecretKey] = useState('');
  const [hcaptchaSecretConfigured, setHcaptchaSecretConfigured] = useState(false);
  const [hcaptchaSecretClear, setHcaptchaSecretClear] = useState(false);

  // Baseline of saved values, for unsaved-changes detection.
  const [baseline, setBaseline] = useState<FormSnapshot | null>(null);

  // TLS certificate (managed independently of the settings form's Save).
  const [tls, setTls] = useState<TlsInfo | null>(null);
  const [tlsBusy, setTlsBusy] = useState(false);
  const [tlsMethod, setTlsMethod] = useState<TlsMethod>(null);
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [chainFile, setChainFile] = useState<File | null>(null);
  // CSR flow
  const [csrCommonName, setCsrCommonName] = useState('');
  const [csrOrganization, setCsrOrganization] = useState('');
  const [csrAltNames, setCsrAltNames] = useState('');
  const [signedCertFile, setSignedCertFile] = useState<File | null>(null);
  const [signedChainFile, setSignedChainFile] = useState<File | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/system-settings', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load system settings');
        const data = (await res.json()) as SystemSettingsResponse;

        const norm: FormSnapshot = {
          timezone: data.timezone || DEFAULT_SYSTEM_TIMEZONE,
          maxUploadSizeMb: Number(data.maxUploadSizeMb) || DEFAULT_MAX_UPLOAD_SIZE_MB,
          allowSignup: data.allowSignup ?? DEFAULT_ALLOW_SIGNUP,
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
          hcaptchaSiteKey: data.hcaptchaSiteKey ?? '',
        };

        setTimezone(norm.timezone);
        setMaxUploadSizeMb(norm.maxUploadSizeMb);
        setAllowSignup(norm.allowSignup);
        setSessionTimeoutMinutes(norm.sessionTimeoutMinutes);
        setEvalTimeoutSec(norm.evalTimeoutSec);
        setResubmitCooldownSec(norm.resubmitCooldownSec);
        setEvalMaxMemoryMb(norm.evalMaxMemoryMb);
        setMaxConcurrent(norm.maxConcurrent);
        setMaxAttempts(norm.maxAttempts);
        setAnalyzerLimit(norm.analyzerLimit);
        setHcaptchaSiteKey(norm.hcaptchaSiteKey);
        setHcaptchaSecretConfigured(Boolean(data.hcaptchaSecretConfigured));
        setHcaptchaSecretKey('');
        setHcaptchaSecretClear(false);
        setBaseline(norm);
      } catch {
        showToast.error('Failed to load system settings.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/system-settings/tls', { cache: 'no-store' });
        if (res.ok) {
          const info = (await res.json()) as TlsInfo;
          setTls(info);
          if (info.pendingCsr) setTlsMethod('csr');
        }
      } catch {
        // non-fatal; TLS card just shows unknown state
      }
    })();
  }, []);

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

  const applyCert = async () => {
    if (!certFile || !keyFile) {
      showToast.error('Select both a certificate and a private key.');
      return;
    }
    setTlsBusy(true);
    try {
      const [cert, key, chain] = await Promise.all([
        certFile.text(),
        keyFile.text(),
        chainFile ? chainFile.text() : Promise.resolve(undefined),
      ]);
      const res = await fetch('/api/system-settings/tls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cert, key, chain }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to apply certificate.');
      setTls(data as TlsInfo);
      setCertFile(null);
      setKeyFile(null);
      setChainFile(null);
      showToast.success('Certificate applied. It may take up to ~15 seconds to take effect.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to apply certificate.');
    } finally {
      setTlsBusy(false);
    }
  };

  const resetCert = async () => {
    setTlsBusy(true);
    try {
      const res = await fetch('/api/system-settings/tls', { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Failed to reset certificate.');
      setTls(data as TlsInfo);
      showToast.success('Reverted to the self-signed certificate.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to reset certificate.');
    } finally {
      setTlsBusy(false);
    }
  };

  const csrFieldsPayload = () => ({
    commonName: csrCommonName.trim(),
    organization: csrOrganization.trim() || undefined,
    altNames: csrAltNames
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });

  const tlsAction = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/system-settings/tls', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || 'The certificate operation failed.');
    return data;
  };

  const downloadText = (filename: string, text: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/x-pem-file' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateCsr = async () => {
    if (!csrCommonName.trim()) {
      showToast.error('Enter a hostname (Common Name) first.');
      return;
    }
    setTlsBusy(true);
    try {
      const data = await tlsAction({ action: 'generate-csr', ...csrFieldsPayload() });
      if (data?.csr) downloadText('afct.csr', data.csr as string);
      setTls(data as TlsInfo);
      showToast.success(
        'CSR generated and downloaded. Send it to your CA to get a signed certificate.',
      );
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to generate CSR.');
    } finally {
      setTlsBusy(false);
    }
  };

  const installSignedCert = async () => {
    if (!signedCertFile) {
      showToast.error('Choose the certificate returned by your CA.');
      return;
    }
    setTlsBusy(true);
    try {
      const [cert, chain] = await Promise.all([
        signedCertFile.text(),
        signedChainFile ? signedChainFile.text() : Promise.resolve(undefined),
      ]);
      const data = await tlsAction({ action: 'install-signed', cert, chain });
      setTls(data as TlsInfo);
      setSignedCertFile(null);
      setSignedChainFile(null);
      showToast.success(
        'Signed certificate installed. It may take up to ~15 seconds to take effect.',
      );
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to install certificate.');
    } finally {
      setTlsBusy(false);
    }
  };

  const generateSelfSigned = async () => {
    if (!csrCommonName.trim()) {
      showToast.error('Enter a hostname (Common Name) first.');
      return;
    }
    setTlsBusy(true);
    try {
      const data = await tlsAction({ action: 'self-signed', ...csrFieldsPayload() });
      setTls(data as TlsInfo);
      showToast.success('Self-signed certificate generated and applied for that hostname.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to generate certificate.');
    } finally {
      setTlsBusy(false);
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
    const resubmitCooldownMs = clampSubmissionResubmitCooldownMs(secToMs(Number(resubmitCooldownSec)));
    const memoryMb = clampSubmissionEvalMaxMemoryMb(Number(evalMaxMemoryMb));
    const concurrent = clampSubmissionMaxConcurrent(Number(maxConcurrent));
    const attempts = clampSubmissionMaxAttempts(Number(maxAttempts));
    const analyzer = clampSubmissionAnalyzerLimit(Number(analyzerLimit));

    setSaving(true);
    try {
      const res = await fetch('/api/system-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timezone,
          maxUploadSizeMb: clampedSize,
          allowSignup,
          sessionTimeoutMinutes: clampedTimeout,
          submissionEvalTimeoutMs: evalTimeoutMs,
          submissionResubmitCooldownMs: resubmitCooldownMs,
          submissionEvalMaxMemoryMb: memoryMb,
          submissionMaxConcurrent: concurrent,
          submissionMaxAttempts: attempts,
          submissionAnalyzerLimit: analyzer,
          hcaptchaSiteKey: hcaptchaSiteKey.trim(),
          ...(hcaptchaSecretClear
            ? { hcaptchaSecretClear: true }
            : hcaptchaSecretKey.trim()
              ? { hcaptchaSecretKey: hcaptchaSecretKey.trim() }
              : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Failed to save settings');
      }
      const savedSiteKey = hcaptchaSiteKey.trim();
      setMaxUploadSizeMb(clampedSize);
      setSessionTimeoutMinutes(clampedTimeout);
      setEvalTimeoutSec(msToSec(evalTimeoutMs));
      setResubmitCooldownSec(msToSec(resubmitCooldownMs));
      setEvalMaxMemoryMb(memoryMb);
      setMaxConcurrent(concurrent);
      setMaxAttempts(attempts);
      setAnalyzerLimit(analyzer);
      setHcaptchaSiteKey(savedSiteKey);
      setHcaptchaSecretConfigured(
        hcaptchaSecretClear ? false : hcaptchaSecretKey.trim() ? true : hcaptchaSecretConfigured,
      );
      setHcaptchaSecretKey('');
      setHcaptchaSecretClear(false);
      setBaseline({
        timezone,
        maxUploadSizeMb: clampedSize,
        allowSignup,
        sessionTimeoutMinutes: clampedTimeout,
        evalTimeoutSec: msToSec(evalTimeoutMs),
        resubmitCooldownSec: msToSec(resubmitCooldownMs),
        evalMaxMemoryMb: memoryMb,
        maxConcurrent: concurrent,
        maxAttempts: attempts,
        analyzerLimit: analyzer,
        hcaptchaSiteKey: savedSiteKey,
      });
      showToast.success('System settings updated successfully.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    if (!baseline) return;
    setTimezone(baseline.timezone);
    setMaxUploadSizeMb(baseline.maxUploadSizeMb);
    setAllowSignup(baseline.allowSignup);
    setSessionTimeoutMinutes(baseline.sessionTimeoutMinutes);
    setEvalTimeoutSec(baseline.evalTimeoutSec);
    setResubmitCooldownSec(baseline.resubmitCooldownSec);
    setEvalMaxMemoryMb(baseline.evalMaxMemoryMb);
    setMaxConcurrent(baseline.maxConcurrent);
    setMaxAttempts(baseline.maxAttempts);
    setAnalyzerLimit(baseline.analyzerLimit);
    setHcaptchaSiteKey(baseline.hcaptchaSiteKey);
    setHcaptchaSecretKey('');
    setHcaptchaSecretClear(false);
  };

  const disabled = loading || saving;

  const currentSnapshot: FormSnapshot = {
    timezone,
    maxUploadSizeMb,
    allowSignup,
    sessionTimeoutMinutes,
    evalTimeoutSec,
    resubmitCooldownSec,
    evalMaxMemoryMb,
    maxConcurrent,
    maxAttempts,
    analyzerLimit,
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

  const cnMissing = !csrCommonName.trim();

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
              className="bg-card border-border h-12 w-full justify-start overflow-x-auto rounded-md border p-1 shadow-sm"
            >
              <TabsTrigger
                value="general"
                className="hover:bg-accent px-4 whitespace-nowrap data-[state=active]:bg-secondary data-[state=active]:text-white"
              >
                General
              </TabsTrigger>
              <TabsTrigger
                value="queue"
                className="hover:bg-accent px-4 whitespace-nowrap data-[state=active]:bg-secondary data-[state=active]:text-white"
              >
                Evaluator
              </TabsTrigger>
              <TabsTrigger
                value="captcha"
                className="hover:bg-accent px-4 whitespace-nowrap data-[state=active]:bg-secondary data-[state=active]:text-white"
              >
                Captcha
              </TabsTrigger>
              <TabsTrigger
                value="tls"
                className="hover:bg-accent px-4 whitespace-nowrap data-[state=active]:bg-secondary data-[state=active]:text-white"
              >
                TLS Certificate
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
                onValueChange={(val) => setTimezone(val)}
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
                setValue={(val) => setMaxUploadSizeMb(val === '' ? '' : Number(val))}
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
                setValue={(val) => setSessionTimeoutMinutes(val === '' ? '' : Number(val))}
                disabled={disabled}
                description={`Signs out after inactivity. ${MIN_SESSION_TIMEOUT_MINUTES}–${MAX_SESSION_TIMEOUT_MINUTES} min.`}
              />
              <SwitchField
                id="allow-signup"
                name="allow-signup"
                label="Allow user signup"
                checked={allowSignup}
                onCheckedChange={setAllowSignup}
                disabled={disabled}
                descriptionPlacement="inline"
                description="When enabled, the Sign up option appears on the login page."
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
                setValue={(val) => setEvalTimeoutSec(val === '' ? '' : Number(val))}
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
                setValue={(val) => setResubmitCooldownSec(val === '' ? '' : Number(val))}
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
                setValue={(val) => setEvalMaxMemoryMb(val === '' ? '' : Number(val))}
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
                setValue={(val) => setMaxConcurrent(val === '' ? '' : Number(val))}
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
                setValue={(val) => setMaxAttempts(val === '' ? '' : Number(val))}
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
                setValue={(val) => setAnalyzerLimit(val === '' ? '' : Number(val))}
                disabled={disabled}
                description={`Depth of the cfganalyzer equivalence check. Higher is more thorough but slower. ${MIN_SUBMISSION_ANALYZER_LIMIT}–${MAX_SUBMISSION_ANALYZER_LIMIT}.`}
              />
            </div>
            </TabsContent>

            <TabsContent value="captcha">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <p className="text-muted-foreground text-sm">
                Optional bot protection, shown as a challenge after repeated failed logins.
              </p>
              <Badge variant={hcaptchaEnabled ? 'success' : 'warning'}>
                {hcaptchaEnabled ? 'hCaptcha enabled' : 'hCaptcha disabled'}
              </Badge>
            </div>
            <div className="max-w-md space-y-5">
              <InputGroup
                label="hCaptcha site key"
                name="hcaptchaSiteKey"
                value={hcaptchaSiteKey}
                setValue={setHcaptchaSiteKey}
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
              {/* Status */}
              <div className="bg-muted/30 rounded-md border p-3 text-sm">
                {tls?.installed ? (
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="info">Custom certificate</Badge>
                      {tls.selfSigned && <Badge variant="outline">Self-signed</Badge>}
                      {tls.expired && <span className="font-medium text-red-600">Expired</span>}
                    </div>
                    {tls.subject && (
                      <div className="text-muted-foreground break-all">Subject: {tls.subject}</div>
                    )}
                    {tls.validTo && (
                      <div className="text-muted-foreground">Valid until: {tls.validTo}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    Using the built-in self-signed certificate. Browsers will show a warning until a
                    trusted certificate is installed.
                  </div>
                )}
              </div>

              {/* Method chooser */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Set up a certificate</div>
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="Certificate setup method"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant={tlsMethod === 'csr' ? 'default' : 'outline'}
                    aria-pressed={tlsMethod === 'csr'}
                    onClick={() => setTlsMethod('csr')}
                  >
                    Generate CSR
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={tlsMethod === 'self-signed' ? 'default' : 'outline'}
                    aria-pressed={tlsMethod === 'self-signed'}
                    onClick={() => setTlsMethod('self-signed')}
                  >
                    Self-signed for hostname
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={tlsMethod === 'upload' ? 'default' : 'outline'}
                    aria-pressed={tlsMethod === 'upload'}
                    onClick={() => setTlsMethod('upload')}
                  >
                    Upload certificate & key
                  </Button>
                </div>
              </div>

              {/* CSR / self-signed share the hostname form */}
              {(tlsMethod === 'csr' || tlsMethod === 'self-signed') && (
                <div className="bg-card space-y-3 rounded-md border p-4">
                  <p className="text-muted-foreground text-xs">
                    {tlsMethod === 'csr'
                      ? 'Enter your hostname and generate a CSR to send to your certificate authority. The private key is created and kept on the server.'
                      : 'Generate a self-signed certificate for this hostname — no certificate authority needed (browsers still warn unless trusted internally).'}
                  </p>
                  <div className="max-w-md space-y-5">
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
                  <div className="flex flex-wrap gap-2">
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
                  </div>

                  {tlsMethod === 'csr' && tls?.pendingCsr && (
                    <div className="bg-card space-y-3 rounded-md border p-3">
                      <p className="text-sm">
                        CSR generated (<span className="font-mono text-xs">afct.csr</span>). Upload
                        the signed certificate from your CA:
                      </p>
                      <div className="max-w-md space-y-4">
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
                </div>
              )}

              {/* Upload existing cert + key */}
              {tlsMethod === 'upload' && (
                <div className="bg-card space-y-3 rounded-md border p-4">
                  <p className="text-muted-foreground text-xs">
                    Upload a certificate and its matching private key (PEM).
                  </p>
                  <div className="max-w-md space-y-4">
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
                  <Button
                    type="button"
                    onClick={applyCert}
                    disabled={tlsBusy || !certFile || !keyFile}
                  >
                    {tlsBusy ? 'Applying…' : 'Apply certificate'}
                  </Button>
                </div>
              )}

              {/* Footer note + reset */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <p className="text-muted-foreground max-w-xl text-xs">
                  Applied by the proxy within ~15 seconds. An invalid certificate is rejected and the
                  self-signed certificate is kept, so HTTPS can’t go down.
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
