'use client';

import type React from 'react';

import { SettingsAsideLayout, SettingsSection } from './settings-layout';
import { PublicAddressCard } from './PublicAddressCard';
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
    // The public address moves to the rail, the same one the status tabs use. It is
    // reference, not a setting: it cannot be edited here, and sitting in the middle of the
    // form as a read-only field it looked like the one control that refused to work.
    <SettingsAsideLayout
      aside={<PublicAddressCard configuredUrl={configuredUrl} loading={loading} />}
    >
      <SettingsSection
        title="Server Configuration"
        description="Default time and display settings for this server."
      >
        {/* A medium column rather than the panel's full width: a timezone name is short,
            and a select stretched across the card reads as a mistake. The switch keeps the
            full width below it, because a setting row is a row. */}
        <div className="max-w-md">
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
          />
        </div>

        <SwitchField
          id="clock-24-hour"
          name="clock-24-hour"
          label="24-hour clock"
          checked={form.clock24Hour}
          onCheckedChange={(v) => setField('clock24Hour', v)}
          disabled={disabled}
          descriptionPlacement="inline"
          description="Display times on a 24-hour clock (e.g. 23:59) instead of 12-hour AM/PM, app-wide."
        />
      </SettingsSection>

      <SettingsSection
        title="Uploads &amp; Retention"
        description="Ceilings on what the server stores: how big one upload may be, and how long the audit trail is kept."
      >
        <div className="grid gap-5 md:grid-cols-2">
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
            label="Audit log retention (days)"
            name="activityLogRetentionDays"
            type="number"
            required
            requiredMark
            min={MIN_ACTIVITY_LOG_RETENTION_DAYS}
            max={MAX_ACTIVITY_LOG_RETENTION_DAYS}
            value={
              form.activityLogRetentionDays === '' ? '' : String(form.activityLogRetentionDays)
            }
            setValue={(val) => setField('activityLogRetentionDays', val === '' ? '' : Number(val))}
            disabled={disabled}
            description={`System Logs older than this are deleted daily. ${MIN_ACTIVITY_LOG_RETENTION_DAYS}–${MAX_ACTIVITY_LOG_RETENTION_DAYS} days.`}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Sign-in &amp; Security"
        description="How sessions end, how lockout works, and who may create an account."
      >
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Sessions and lockout</h3>
          {/* Two columns, not three. The rail took ~280px off this panel, and at three
                columns "Account lockout duration (minutes)" wrapped, which left its
                required marker floating on the far side of a two-line label. */}
          <div className="grid gap-5 md:grid-cols-2">
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
          </div>
        </div>
        {/* Two groups in one panel, split by a rule rather than a second card: the three
              fields above are about an existing account's session, and these two are about
              whether new accounts can be made at all. The domain list only means anything
              while signup is on, which is why it sits with the switch and greys out with
              it. */}
        <div className="space-y-3 border-t pt-4">
          <h3 className="text-sm font-semibold">Account creation</h3>
          <SwitchField
            id="allow-signup"
            name="allow-signup"
            label="Allow user signup"
            checked={form.allowSignup}
            onCheckedChange={(v) => setField('allowSignup', v)}
            disabled={disabled}
            descriptionPlacement="inline"
            description="When enabled, the Sign up option appears on the login page."
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
        </div>
      </SettingsSection>
    </SettingsAsideLayout>
  );
}
