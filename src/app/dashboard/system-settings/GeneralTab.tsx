'use client';

import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import SwitchField from '@/components/ui/SwitchField';
import {
  MIN_SESSION_TIMEOUT_MINUTES,
  MAX_SESSION_TIMEOUT_MINUTES,
  MIN_LOGIN_MAX_ATTEMPTS,
  MAX_LOGIN_MAX_ATTEMPTS,
  MIN_LOGIN_LOCKOUT_MINUTES,
  MAX_LOGIN_LOCKOUT_MINUTES,
  MIN_ACTIVITY_LOG_RETENTION_DAYS,
  MAX_ACTIVITY_LOG_RETENTION_DAYS,
} from '@/lib/system-settings';
import type { FormSnapshot, SetField } from './system-settings-shared';

/** General tab: server defaults for time, uploads, and sign-in. */
export function GeneralTab({
  form,
  setField,
  disabled,
  loading,
  configuredUrl,
  timezoneOptions,
}: {
  form: FormSnapshot;
  setField: SetField;
  disabled: boolean;
  loading: boolean;
  configuredUrl: string | undefined;
  timezoneOptions: { value: string; label: string }[];
}) {
  return (
    <>
      <p className="text-muted-foreground mb-4 text-sm">
        Server defaults for time, uploads, and sign-in.
      </p>
      {/* All General fields stacked in a single, consistently-sized column. */}
      <div className="max-w-md space-y-5">
        {/* Read-only: NEXTAUTH_URL is a server-level env var, not a stored
            setting. Shown for reference with instructions to change it. */}
        <div className="space-y-1">
          <p className="text-sm font-medium">Configured URL</p>
          <p className="bg-muted/10 rounded-md border px-3 py-2 font-mono text-sm break-all">
            {loading ? 'Loading…' : configuredUrl ? configuredUrl : 'Not set'}
          </p>
          <p className="text-muted-foreground text-xs">
            The public address AFCT uses for sign-in links and redirects (the{' '}
            <code className="font-mono">NEXTAUTH_URL</code> environment variable). It is read-only
            here because it is set at the server level and only takes effect after a restart. To
            change it, re-run the installer on the server with the new address (
            <code className="font-mono">sh install.sh --reconfigure</code>, or pass{' '}
            <code className="font-mono">APP_URL=https://new.address</code>). That rewrites the
            value, restarts the stack, and preserves your data and secrets.
          </p>
        </div>
        <SelectField
          label="Timezone"
          name="timezone"
          id="timezone"
          requiredMark
          placeholder={loading ? 'Loading timezone...' : 'Select timezone'}
          value={loading ? '' : form.timezone}
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
          value={form.maxUploadSizeMb === '' ? '' : String(form.maxUploadSizeMb)}
          setValue={(val) => setField('maxUploadSizeMb', val === '' ? '' : Number(val))}
          disabled={disabled}
          description="Applies to all uploads. 1–50 MB."
        />
        <InputGroup
          label="Session timeout (minutes)"
          name="sessionTimeoutMinutes"
          type="number"
          required
          requiredMark
          min={MIN_SESSION_TIMEOUT_MINUTES}
          max={MAX_SESSION_TIMEOUT_MINUTES}
          value={form.sessionTimeoutMinutes === '' ? '' : String(form.sessionTimeoutMinutes)}
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
          value={form.loginMaxAttempts === '' ? '' : String(form.loginMaxAttempts)}
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
          value={form.loginLockoutMinutes === '' ? '' : String(form.loginLockoutMinutes)}
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
          value={form.activityLogRetentionDays === '' ? '' : String(form.activityLogRetentionDays)}
          setValue={(val) => setField('activityLogRetentionDays', val === '' ? '' : Number(val))}
          disabled={disabled}
          description={`System Logs older than this are deleted daily. ${MIN_ACTIVITY_LOG_RETENTION_DAYS}–${MAX_ACTIVITY_LOG_RETENTION_DAYS} days.`}
        />
        <SwitchField
          id="allow-signup"
          name="allow-signup"
          label="Allow user signup"
          checked={form.allowSignup}
          onCheckedChange={(v) => setField('allowSignup', v)}
          disabled={disabled}
          descriptionPlacement="inline"
          description="When enabled, the Sign up option appears on the login page."
          boxClassName="border-black"
        />
        <InputGroup
          label="Allowed signup email domains"
          name="signup-allowed-domains"
          value={form.signupAllowedDomains}
          setValue={(v) => setField('signupAllowedDomains', v)}
          disabled={disabled || !form.allowSignup}
          placeholder="psu.edu, example.edu"
          description="Restrict self-signup to these email domains (comma-separated). Leave blank to allow any domain."
        />
        <SwitchField
          id="clock-24-hour"
          name="clock-24-hour"
          label="24-hour clock"
          checked={form.clock24Hour}
          onCheckedChange={(v) => setField('clock24Hour', v)}
          disabled={disabled}
          descriptionPlacement="inline"
          description="Display times on a 24-hour clock (e.g. 23:59) instead of 12-hour AM/PM, app-wide."
          boxClassName="border-black"
        />
      </div>
    </>
  );
}
