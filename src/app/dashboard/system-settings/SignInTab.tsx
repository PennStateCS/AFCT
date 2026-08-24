'use client';

import { Badge } from '@/components/ui/badge';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import { DEFAULT_OIDC_BUTTON_LABEL } from '@/schemas/identity';
import { SETTINGS_BOX_CLASS } from './system-settings-shared';
import {
  SETTINGS_COMPACT,
  SETTINGS_READABLE,
  SETTINGS_STANDARD,
  SettingsSection,
  SettingsStatusPanel,
} from './settings-layout';
import type { SetField } from './system-settings-shared';

/**
 * Sign-in tab: letting people use their institution's account instead of an AFCT password.
 *
 * Local sign-in is never replaced. It stays available whatever is configured here, so a
 * misconfigured provider cannot lock an administrator out of their own install.
 */
export function SignInTab({
  enabled,
  issuer,
  clientId,
  buttonLabel,
  trustEmail,
  allowLinkedAccountPasswords,
  setField,
  disabled,
  clientSecret,
  setClientSecret,
  clientSecretConfigured,
  clientSecretReadable,
  clientSecretClear,
  setClientSecretClear,
  redirectUri,
}: {
  enabled: boolean;
  issuer: string;
  clientId: string;
  buttonLabel: string;
  trustEmail: boolean;
  /** Whether somebody who signs in elsewhere may also set an AFCT password for themselves. */
  allowLinkedAccountPasswords: boolean;
  setField: SetField;
  disabled: boolean;
  clientSecret: string;
  setClientSecret: (value: string) => void;
  clientSecretConfigured: boolean;
  /**
   * Whether the stored secret can be decrypted here. A stored secret this deployment cannot
   * read leaves institutional sign-in switched on and unusable, and nothing on the sign-in page
   * says so: the button is simply absent.
   */
  clientSecretReadable: boolean;
  clientSecretClear: boolean;
  setClientSecretClear: (value: boolean) => void;
  /** What the identity provider must be told to allow. Read-only; derived from the site URL. */
  redirectUri: string;
}) {
  return (
    <>
      <SettingsSection title="Current status" className={`${SETTINGS_COMPACT} mb-6`} boxed={false}>
        <SettingsStatusPanel>
          <Badge
            variant={!enabled ? 'neutral' : clientSecretReadable ? 'success' : 'danger'}
            className="w-fit"
          >
            {!enabled ? 'Disabled' : clientSecretReadable ? 'Enabled' : 'Enabled, but unavailable'}
          </Badge>
          <p className="text-muted-foreground">
            {!enabled
              ? 'Everyone signs in with an AFCT password.'
              : clientSecretReadable
                ? 'People can sign in with their institution. AFCT passwords still work as well.'
                : 'The saved client secret cannot be read, so the institution button is not shown and nobody can sign in that way. This usually means the encryption key this AFCT was set up with has changed. Save the secret again, or restore the key.'}
          </p>
        </SettingsStatusPanel>
      </SettingsSection>

      <div className={`${SETTINGS_STANDARD} ${SETTINGS_BOX_CLASS} bg-card`}>
        <SwitchField
          id="oidc-enabled"
          name="oidc-enabled"
          label="Allow institutional sign-in"
          checked={enabled}
          onCheckedChange={(v) => setField('oidcEnabled', v)}
          disabled={disabled}
          descriptionPlacement="inline"
          description="AFCT passwords keep working either way."
        />
        <InputGroup
          label="Issuer URL"
          name="oidcIssuer"
          value={issuer}
          setValue={(v) => setField('oidcIssuer', v)}
          disabled={disabled}
          placeholder="https://login.your-university.edu"
          description="Everything else is discovered from this. Copy it exactly as your provider states it, including a trailing slash if it has one."
        />
        <InputGroup
          label="Client ID"
          name="oidcClientId"
          value={clientId}
          setValue={(v) => setField('oidcClientId', v)}
          disabled={disabled}
          description="Issued by your IT department when they register AFCT."
        />
        <InputGroup
          label="Client secret"
          name="oidcClientSecret"
          type="password"
          // The server's credential, not the admin's. Without this a password manager
          // offers to save it as their AFCT password, and to autofill it back later.
          autoComplete="off"
          showEye
          value={clientSecret}
          setValue={setClientSecret}
          disabled={disabled || clientSecretClear}
          placeholder={clientSecretConfigured ? 'Saved — leave blank to keep' : 'Enter secret'}
          description="Stored encrypted, never shown again."
        />
        {clientSecretConfigured && (
          <SwitchField
            id="oidc-secret-clear"
            name="oidc-secret-clear"
            label="Remove saved client secret"
            checked={clientSecretClear}
            onCheckedChange={setClientSecretClear}
            disabled={disabled}
            descriptionPlacement="inline"
            description="Deletes the stored secret when you save."
          />
        )}
        <InputGroup
          label="Button wording"
          name="oidcButtonLabel"
          value={buttonLabel}
          setValue={(v) => setField('oidcButtonLabel', v)}
          disabled={disabled}
          placeholder={DEFAULT_OIDC_BUTTON_LABEL}
          description="What the sign-in button says. Use whatever your institution calls its login."
        />
      </div>

      <div className={`mt-6 space-y-3 border-t pt-5 ${SETTINGS_READABLE}`}>
        <h2 className="text-base font-semibold">Give this to your IT department</h2>
        <p className="text-muted-foreground text-xs">
          The redirect URL AFCT will use. Registration usually fails without it, with an error about
          a mismatched redirect.
        </p>
        <InputGroup
          label="Redirect URL"
          name="oidcRedirectUri"
          value={redirectUri}
          setValue={() => {}}
          readOnly
        />
      </div>

      <div className={`mt-6 space-y-3 border-t pt-5 ${SETTINGS_READABLE}`}>
        <h2 className="text-base font-semibold">Matching people to accounts</h2>
        <p className="text-muted-foreground text-xs">
          When somebody signs in for the first time, AFCT attaches their institutional identity to
          an existing account with the same email address, but only if the provider states that the
          address is verified.
        </p>
        <SwitchField
          id="oidc-trust-email"
          name="oidc-trust-email"
          label="Trust this provider's email addresses"
          checked={trustEmail}
          onCheckedChange={(v) => setField('oidcTrustEmail', v)}
          disabled={disabled}
          descriptionPlacement="inline"
          description="Only turn this on if your provider controls the addresses it reports."
        />
        {/* Not hidden behind a tooltip: this is the one setting on the page that can hand
            somebody another person's account, and the reason it exists at all is that the
            common case (Microsoft) omits the claim. */}
        <p className="text-muted-foreground text-xs">
          Some providers, including Microsoft Entra, never mark addresses as verified. Without this,
          nobody at those institutions is matched automatically. With it on at a provider where
          people can choose their own address, someone could reach an account that is not theirs.
          Administrator accounts are never matched automatically either way.
        </p>
        {/* The distinction people got wrong: this setting answers an unverified address, not a
            missing one, and Entra can send no address at all unless the claim is released. */}
        <p className="text-muted-foreground text-xs">
          This does not help if your provider sends no address at all. On Entra the email claim has
          to be released on the app registration, or through the OpenID scope on v2.0 endpoints;
          without it, people are refused with &ldquo;your institution did not share an email
          address&rdquo; whatever this setting says.
        </p>
      </div>
      <div className="mt-6 space-y-2">
        <h2 className="text-base font-semibold">AFCT passwords</h2>
        <div className={SETTINGS_BOX_CLASS}>
          <SwitchField
            id="allow-linked-account-passwords"
            name="allow-linked-account-passwords"
            label="Let people who sign in through an institution or an LMS also set an AFCT password"
            checked={allowLinkedAccountPasswords}
            onCheckedChange={(v) => setField('allowLinkedAccountPasswords', v)}
            disabled={disabled}
            descriptionPlacement="inline"
            description="They can set one from their own Account page. Turn this off if people must always sign in the way your institution requires."
          />
          <p className="text-muted-foreground mt-2 text-sm">
            You can always set a password for someone yourself, whichever way this is set, so
            turning it off cannot leave anybody with no way back in. Note that the AFCT desktop
            client signs in with an email and a password, so a student who only ever opens AFCT from
            your LMS needs one to use it. With this off, an administrator who signs in through your
            institution also cannot confirm an LMS launch, which asks for an AFCT password.
          </p>
        </div>
      </div>
    </>
  );
}

export default SignInTab;
