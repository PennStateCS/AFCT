'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
  DEFAULT_ALLOW_SIGNUP,
  DEFAULT_MAX_UPLOAD_SIZE_MB,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DEFAULT_SYSTEM_TIMEZONE,
  DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS,
  DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB,
  DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS,
  DEFAULT_SUBMISSION_MAX_CONCURRENT,
  DEFAULT_SUBMISSION_MAX_ATTEMPTS,
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
} from '@/lib/system-settings';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import SwitchField from '@/components/ui/SwitchField';

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
};

const msToSec = (ms: number) => Math.round(ms / 1000);
const secToMs = (sec: number) => Math.round(sec * 1000);

export default function SystemSettingsClient() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/system-settings', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load system settings');
        const data = (await res.json()) as SystemSettingsResponse;
        setTimezone(data.timezone || DEFAULT_SYSTEM_TIMEZONE);
        setMaxUploadSizeMb(Number(data.maxUploadSizeMb) || DEFAULT_MAX_UPLOAD_SIZE_MB);
        setAllowSignup(data.allowSignup ?? DEFAULT_ALLOW_SIGNUP);
        setSessionTimeoutMinutes(
          clampSessionTimeoutMinutes(
            Number(data.sessionTimeoutMinutes) || DEFAULT_SESSION_TIMEOUT_MINUTES,
          ),
        );
        setEvalTimeoutSec(
          msToSec(Number(data.submissionEvalTimeoutMs) || DEFAULT_SUBMISSION_EVAL_TIMEOUT_MS),
        );
        setResubmitCooldownSec(
          msToSec(
            Number(data.submissionResubmitCooldownMs) || DEFAULT_SUBMISSION_RESUBMIT_COOLDOWN_MS,
          ),
        );
        setEvalMaxMemoryMb(
          Number(data.submissionEvalMaxMemoryMb) || DEFAULT_SUBMISSION_EVAL_MAX_MEMORY_MB,
        );
        setMaxConcurrent(Number(data.submissionMaxConcurrent) || DEFAULT_SUBMISSION_MAX_CONCURRENT);
        setMaxAttempts(Number(data.submissionMaxAttempts) || DEFAULT_SUBMISSION_MAX_ATTEMPTS);
      } catch {
        showToast.error('Failed to load system settings.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

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
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || 'Failed to save settings');
      }
      setMaxUploadSizeMb(clampedSize);
      setSessionTimeoutMinutes(clampedTimeout);
      setEvalTimeoutSec(msToSec(evalTimeoutMs));
      setResubmitCooldownSec(msToSec(resubmitCooldownMs));
      setEvalMaxMemoryMb(memoryMb);
      setMaxConcurrent(concurrent);
      setMaxAttempts(attempts);
      showToast.success('System settings updated successfully.');
    } catch (err) {
      showToast.error(err instanceof Error ? err.message : 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const disabled = loading || saving;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4 pb-8">
      <p className="sr-only" aria-live="polite">
        {loading ? 'Loading system settings' : saving ? 'Saving system settings' : ''}
      </p>

      <Card aria-labelledby="system-settings-title">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 id="system-settings-title" className="text-2xl leading-none font-semibold">
              System Settings
            </h1>
            <Badge variant="info">Beta Feature</Badge>
          </div>
          <div className="text-muted-foreground text-sm">
            Configuration tools will be added here over time.
          </div>
        </CardHeader>
      </Card>

      <form onSubmit={onSubmit} aria-busy={disabled} className="space-y-4">
        {/* Cards sit side by side once there's room, and stack below xl. */}
        <div className="grid gap-4 xl:grid-cols-2">
          <Card aria-labelledby="system-settings-general-title">
            <CardHeader>
              <h2 id="system-settings-general-title" className="text-lg leading-none font-semibold">
                General
              </h2>
            </CardHeader>
            <CardContent>
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
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
                </div>
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
                  description="Applies to all uploads. Range: 1–1024 MB."
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
                  description={`Signs users out after inactivity. Range: ${MIN_SESSION_TIMEOUT_MINUTES}–${MAX_SESSION_TIMEOUT_MINUTES} min.`}
                />
                <div className="sm:col-span-2 sm:max-w-md">
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
              </div>
            </CardContent>
          </Card>

          <Card aria-labelledby="system-settings-queue-title">
            <CardHeader>
              <h2 id="system-settings-queue-title" className="text-lg leading-none font-semibold">
                Submission Queue
              </h2>
            </CardHeader>
            <CardContent>
              <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
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
                  description={`Max time one submission may evaluate before it is killed. Range: ${msToSec(MIN_SUBMISSION_EVAL_TIMEOUT_MS)}–${msToSec(MAX_SUBMISSION_EVAL_TIMEOUT_MS)} s.`}
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
                  description="Minimum wait between a student's submissions to the same problem. 0 disables it."
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
                  description={`JVM heap limit per evaluation. Range: ${MIN_SUBMISSION_EVAL_MAX_MEMORY_MB}–${MAX_SUBMISSION_EVAL_MAX_MEMORY_MB} MB.`}
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
                  description={`How many submissions evaluate at once. Range: ${MIN_SUBMISSION_MAX_CONCURRENT}–${MAX_SUBMISSION_MAX_CONCURRENT}. Applies within ~30s.`}
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
                  description={`Times a failing submission is retried before being marked failed. Range: ${MIN_SUBMISSION_MAX_ATTEMPTS}–${MAX_SUBMISSION_MAX_ATTEMPTS}.`}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Floating action bar spanning the full content width. */}
        <div className="sticky bottom-4 z-10 flex justify-end gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
          <Button type="submit" aria-label="Save system settings" disabled={disabled}>
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
