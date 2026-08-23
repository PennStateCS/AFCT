'use client';

import { useState } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import { SETTINGS_BOX_CLASS } from './system-settings-shared';
import { SETTINGS_COMPACT, SettingsSection, SettingsStatusPanel } from './settings-layout';
import type { SetField } from './system-settings-shared';

/** Captcha tab: hCaptcha keys + a live "test my keys" flow. */
export function CaptchaTab({
  siteKey,
  setField,
  disabled,
  secretKey,
  setSecretKey,
  secretConfigured,
  secretClear,
  setSecretClear,
  hcaptchaEnabled,
  savedSiteKey,
}: {
  siteKey: string;
  setField: SetField;
  disabled: boolean;
  secretKey: string;
  setSecretKey: (value: string) => void;
  secretConfigured: boolean;
  secretClear: boolean;
  setSecretClear: (value: boolean) => void;
  hcaptchaEnabled: boolean;
  /** The saved (server) site key, used for the live test challenge. */
  savedSiteKey: string | undefined;
}) {
  // "Test captcha" flow: render a real hCaptcha with the saved keys and verify the
  // solved token against the stored secret so an admin can confirm both keys work.
  const [captchaTestOpen, setCaptchaTestOpen] = useState(false);
  const [captchaTestResult, setCaptchaTestResult] = useState<'idle' | 'verifying' | 'ok' | 'fail'>(
    'idle',
  );

  const handleCaptchaTestVerify = async (token: string) => {
    setCaptchaTestResult('verifying');
    try {
      const res = await fetch('/api/admin/settings/captcha-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setCaptchaTestResult(res.ok && data.ok ? 'ok' : 'fail');
    } catch {
      setCaptchaTestResult('fail');
    }
  };

  return (
    <>
      {/* Current status */}
      <SettingsSection title="Current status" className={`${SETTINGS_COMPACT} mb-6`} boxed={false}>
        <SettingsStatusPanel>
          <Badge variant={hcaptchaEnabled ? 'success' : 'warning'} className="w-fit">
            {hcaptchaEnabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <p className="text-muted-foreground">
            {hcaptchaEnabled
              ? 'Bot protection is on. After repeated failed logins, users are shown an hCaptcha challenge.'
              : 'Bot protection is off. Add your hCaptcha keys below to turn it on.'}
          </p>
        </SettingsStatusPanel>
      </SettingsSection>

      <div className={`${SETTINGS_COMPACT} ${SETTINGS_BOX_CLASS} bg-card`}>
        <InputGroup
          label="hCaptcha site key"
          name="hcaptchaSiteKey"
          value={siteKey}
          setValue={(v) => setField('hcaptchaSiteKey', v)}
          disabled={disabled}
          description="Public key. Leave blank to disable."
        />
        <InputGroup
          label="hCaptcha secret key"
          name="hcaptchaSecretKey"
          type="password"
          // A service credential, not the admin's own. See SignInTab's client secret.
          autoComplete="off"
          showEye
          value={secretKey}
          setValue={setSecretKey}
          disabled={disabled || secretClear}
          placeholder={secretConfigured ? 'Saved — leave blank to keep' : 'Enter secret key'}
          description="Private key. Stored securely, never shown again."
        />
        {secretConfigured && (
          <SwitchField
            id="hcaptcha-secret-clear"
            name="hcaptcha-secret-clear"
            label="Remove saved secret key"
            checked={secretClear}
            onCheckedChange={setSecretClear}
            disabled={disabled}
            descriptionPlacement="inline"
            description="Deletes the stored secret when you save."
          />
        )}
      </div>
      {/* Verify the saved keys actually work before relying on them. */}
      <div className={`mt-6 space-y-3 border-t pt-5 ${SETTINGS_COMPACT}`}>
        <h2 className="text-base font-semibold">Verify your keys</h2>
        {savedSiteKey && secretConfigured ? (
          <>
            <p className="text-muted-foreground text-xs">
              Loads a real hCaptcha challenge with your saved site key and checks the result against
              your saved secret, so you can confirm bot protection works.
            </p>
            {!captchaTestOpen ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setCaptchaTestResult('idle');
                  setCaptchaTestOpen(true);
                }}
              >
                Test captcha
              </Button>
            ) : (
              <div className="space-y-3">
                <HCaptcha
                  sitekey={savedSiteKey}
                  onVerify={handleCaptchaTestVerify}
                  onExpire={() => setCaptchaTestResult('idle')}
                  onError={() => setCaptchaTestResult('fail')}
                  reCaptchaCompat={false}
                />
                <div role="status" aria-live="polite">
                  {captchaTestResult === 'verifying' && (
                    <span className="text-muted-foreground text-sm">Verifying…</span>
                  )}
                  {captchaTestResult === 'ok' && (
                    <Badge variant="success" className="w-fit">
                      Your hCaptcha keys are working
                    </Badge>
                  )}
                  {captchaTestResult === 'fail' && (
                    <div className="space-y-1">
                      <Badge variant="destructive" className="w-fit">
                        Verification failed
                      </Badge>
                      <p className="text-muted-foreground text-xs">
                        The challenge did not verify against your saved secret. Check that the site
                        key and secret key belong to the same hCaptcha site.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            Save a site key and secret key above, then come back here to test them.
          </p>
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
    </>
  );
}
