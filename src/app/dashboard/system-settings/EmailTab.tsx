'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import SelectField from '@/components/ui/SelectField';
import SwitchField from '@/components/ui/SwitchField';
import { SMTP_SECURITY, SMTP_SECURITY_LABELS, type SmtpSecurity } from '@/schemas/smtp';
import { SETTINGS_BOX_CLASS } from './system-settings-shared';
import {
  SETTINGS_COMPACT,
  SETTINGS_STANDARD,
  SettingsSection,
  SettingsStatusPanel,
} from './settings-layout';
import type { SetField } from './system-settings-shared';

type TestState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; to: string }
  | { phase: 'failed'; message: string };

/**
 * Email tab: the mail server AFCT sends from, and a way to prove it works.
 *
 * The test button is the point of this screen as much as the fields are. Nobody should find out
 * their mail settings are wrong at the moment a student cannot get back into their account.
 */
export function EmailTab({
  enabled,
  host,
  port,
  security,
  username,
  fromAddress,
  fromName,
  setField,
  disabled,
  password,
  setPassword,
  passwordConfigured,
  passwordReadable,
  passwordClear,
  setPasswordClear,
  savedHost,
  dirty,
}: {
  enabled: boolean;
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string;
  fromAddress: string;
  fromName: string;
  setField: SetField;
  disabled: boolean;
  password: string;
  setPassword: (value: string) => void;
  passwordConfigured: boolean;
  /**
   * Whether the stored password can be decrypted here. A password this deployment cannot read
   * leaves mail switched on and unable to send, and nothing else on the page would say so.
   */
  passwordReadable: boolean;
  passwordClear: boolean;
  setPasswordClear: (value: boolean) => void;
  /** The saved (server) host, so the test offer reflects what is stored rather than typed. */
  savedHost: string | undefined;
  /** Whether the form has unsaved edits, which the test would not use. */
  dirty: boolean;
}) {
  const [testTo, setTestTo] = useState('');
  const [test, setTest] = useState<TestState>({ phase: 'idle' });

  const sendTest = async () => {
    setTest({ phase: 'sending' });
    try {
      const res = await fetch('/api/admin/settings/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testTo }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setTest({ phase: 'sent', to: testTo });
      else setTest({ phase: 'failed', message: data.error ?? 'The message could not be sent.' });
    } catch {
      setTest({ phase: 'failed', message: 'Could not reach the server. Check your connection.' });
    }
  };

  return (
    <>
      <SettingsSection title="Current status" className={`${SETTINGS_COMPACT} mb-6`} boxed={false}>
        <SettingsStatusPanel>
          <Badge
            variant={!enabled ? 'warning' : passwordReadable ? 'success' : 'destructive'}
            className="w-fit"
          >
            {!enabled ? 'Disabled' : passwordReadable ? 'Enabled' : 'Enabled, but unavailable'}
          </Badge>
          <p className="text-muted-foreground">
            {!enabled
              ? 'AFCT sends no email. Passwords can only be reset by an administrator.'
              : passwordReadable
                ? 'AFCT is set up to send email. Send a test message below to check that it arrives; a reset request that cannot be delivered fails quietly, because the sign-in page must not say whether an account exists.'
                : 'The saved mail password cannot be read, so nothing can be sent and reset requests will fail quietly. This usually means the encryption key this AFCT was set up with has changed. Enter the password again, or restore the key.'}
          </p>
        </SettingsStatusPanel>
      </SettingsSection>

      <div className={`${SETTINGS_STANDARD} ${SETTINGS_BOX_CLASS} bg-card`}>
        <SwitchField
          id="smtp-enabled"
          name="smtp-enabled"
          label="Send email from this site"
          checked={enabled}
          onCheckedChange={(v) => setField('smtpEnabled', v)}
          disabled={disabled}
          descriptionPlacement="inline"
          description="Off until a mail server is configured below."
        />
        {/* Host and port belong together, and the port is capped so it does not inherit a
            text field's width just because it shares a row with one. */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <InputGroup
            label="Mail server"
            name="smtpHost"
            value={host}
            setValue={(v) => setField('smtpHost', v)}
            disabled={disabled}
            placeholder="smtp.your-university.edu"
            description="Your institution's SMTP server. Ask your IT department if you are unsure."
          />
          <InputGroup
            label="Port"
            name="smtpPort"
            type="number"
            value={String(port)}
            setValue={(v) => setField('smtpPort', Number(v))}
            disabled={disabled}
            description="587 for STARTTLS, 465 for TLS."
          />
        </div>
        <SelectField
          label="Encryption"
          name="smtpSecurity"
          value={security}
          onValueChange={(v) => setField('smtpSecurity', v as SmtpSecurity)}
          disabled={disabled}
          options={SMTP_SECURITY.map((value) => ({
            value,
            label: SMTP_SECURITY_LABELS[value],
          }))}
          description="STARTTLS suits most institutional servers. Choose None only for a server that needs no sign-in: a username and password cannot be sent over an unencrypted connection."
        />
        <InputGroup
          label="Username"
          name="smtpUsername"
          value={username}
          setValue={(v) => setField('smtpUsername', v)}
          disabled={disabled}
          description="Leave blank if your server does not require sign-in. Needs STARTTLS or TLS."
        />
        <InputGroup
          label="Password"
          name="smtpPassword"
          type="password"
          // The SMTP account's password, not the admin's. See SignInTab's client secret.
          autoComplete="off"
          showEye
          value={password}
          setValue={setPassword}
          disabled={disabled || passwordClear}
          placeholder={passwordConfigured ? 'Saved — leave blank to keep' : 'Enter password'}
          description="Stored encrypted, never shown again. Saved exactly as typed, spaces included."
        />
        {passwordConfigured && (
          <SwitchField
            id="smtp-password-clear"
            name="smtp-password-clear"
            label="Remove saved password"
            checked={passwordClear}
            onCheckedChange={setPasswordClear}
            disabled={disabled}
            descriptionPlacement="inline"
            description="Deletes the stored password when you save."
          />
        )}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <InputGroup
            label="From address"
            name="smtpFromAddress"
            type="email"
            // The institution's sending address, not the admin's own.
            autoComplete="off"
            value={fromAddress}
            setValue={(v) => setField('smtpFromAddress', v)}
            disabled={disabled}
            placeholder="afct@your-university.edu"
            description="Institutions usually require this to be an address they host."
          />
          <InputGroup
            label="From name"
            name="smtpFromName"
            value={fromName}
            setValue={(v) => setField('smtpFromName', v)}
            disabled={disabled}
            placeholder="AFCT"
            description="Shown beside the address in the recipient's inbox."
          />
        </div>
      </div>

      {/* Prove it works now, rather than when someone is locked out. */}
      <div className={`mt-6 space-y-3 border-t pt-5 ${SETTINGS_COMPACT}`}>
        <h2 className="text-base font-semibold">Send a test message</h2>
        {savedHost ? (
          <>
            <p className="text-muted-foreground text-xs">
              Sends a message using the saved settings, so you can confirm email works before anyone
              needs it.
              {dirty
                ? ' Save your changes first: this uses what is stored, not what you typed.'
                : ''}
            </p>
            <InputGroup
              label="Send to"
              name="smtpTestTo"
              type="email"
              autoComplete="off"
              value={testTo}
              setValue={setTestTo}
              disabled={disabled || test.phase === 'sending'}
              placeholder="you@your-university.edu"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || !testTo || test.phase === 'sending'}
              onClick={() => void sendTest()}
            >
              {test.phase === 'sending' ? 'Sending…' : 'Send test message'}
            </Button>
            {/* One live region for this status area, so a result is announced once. */}
            <div role="status" aria-live="polite" className="text-sm">
              {test.phase === 'sent' ? (
                <p className="text-status-success">
                  Test message sent to {test.to}. If it does not arrive, check the recipient&apos;s
                  spam folder.
                </p>
              ) : null}
              {test.phase === 'failed' ? <p className="text-destructive">{test.message}</p> : null}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            Add a mail server and save to send a test message.
          </p>
        )}
      </div>
    </>
  );
}

export default EmailTab;
