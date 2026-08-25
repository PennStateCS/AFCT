'use client';

import { Badge } from '@/components/ui/badge';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';

import { CopyableValue } from './CopyableValue';
import { DEFAULT_OIDC_BUTTON_LABEL } from '@/schemas/identity';

import {
  SettingsAsideCard,
  SettingsSection,
  SettingsStatusCard,
  SettingsAsideLayout,
  SettingsStatusNextStep,
  SettingsStatusText,
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
    <SettingsAsideLayout
      aside={
        <>
          <SettingsStatusCard
            title="Current status"
            tone={!enabled ? 'off' : clientSecretReadable ? 'ok' : 'bad'}
            badge={
              <Badge variant={!enabled ? 'neutral' : clientSecretReadable ? 'success' : 'danger'}>
                {!enabled
                  ? 'Disabled'
                  : clientSecretReadable
                    ? 'Enabled'
                    : 'Enabled, but unavailable'}
              </Badge>
            }
            headline={
              !enabled
                ? 'Institutional sign-in is off'
                : clientSecretReadable
                  ? 'Institutional sign-in is available'
                  : 'Institutional sign-in is unavailable'
            }
          >
            {/* "AFCT passwords still work" belongs here, in both working states: it is the
                thing an admin is worried about when they touch this page. The provider and
                email-matching rules do NOT: those are decisions you make in the form. */}
            {!enabled && (
              <>
                <SettingsStatusText>Everyone signs in with an AFCT password.</SettingsStatusText>
                <SettingsStatusNextStep>Turn it on to add your provider.</SettingsStatusNextStep>
              </>
            )}
            {enabled && clientSecretReadable && (
              <SettingsStatusText>
                People can sign in with their institution. AFCT passwords still work as well.
              </SettingsStatusText>
            )}
            {enabled && !clientSecretReadable && (
              <>
                <SettingsStatusText>
                  The saved client secret cannot be read, so the institution button is not shown.
                  This usually means the encryption key this AFCT was set up with has changed. AFCT
                  passwords still work.
                </SettingsStatusText>
                <SettingsStatusNextStep>
                  Save the secret again, or restore the key.
                </SettingsStatusNextStep>
              </>
            )}
          </SettingsStatusCard>

          {/* Reference, not configuration: a value you hand to somebody else, so it sits in
              the rail with a copy button rather than as a read-only field in the middle of
              the form. Same treatment as LTI's manual endpoints and the public address. */}
          <SettingsAsideCard title="For your IT department">
            <CopyableValue
              label="Redirect URL"
              value={redirectUri}
              copyName="redirect URL"
              description="Registration usually fails without it, with an error about a mismatched redirect."
            />
          </SettingsAsideCard>
        </>
      }
    >
      <SettingsSection title="Institutional sign-in">
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
      </SettingsSection>

      <SettingsSection
        title="Matching people to accounts"
        description="When somebody signs in for the first time, AFCT attaches their institutional identity to an existing account with the same email address, but only if the provider states that the address is verified."
      >
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
        {/*
          One note, not two loose paragraphs after a switch. Neutral bg-muted and not a
          warning colour: this is a detail about how providers behave, and the page has no
          warning state to report. Deliberately NOT a tooltip either: this is the one
          setting here that can hand somebody another person's account, and the reason it
          exists at all is that the common case (Microsoft) omits the claim.
        */}
        <div className="bg-muted/40 max-w-3xl space-y-2 rounded-md border p-3">
          <p className="text-foreground text-xs font-medium">If your provider is Microsoft Entra</p>
          <p className="text-muted-foreground text-xs leading-4.5">
            Entra never marks addresses as verified, so without this setting nobody at those
            institutions is matched automatically. With it on at a provider where people can choose
            their own address, someone could reach an account that is not theirs. Administrator
            accounts are never matched automatically either way.
          </p>
          <p className="text-muted-foreground text-xs leading-4.5">
            It does not help if your provider sends no address at all. On Entra the email claim has
            to be released on the app registration, or through the OpenID scope on v2.0 endpoints;
            without it, people are refused with &ldquo;your institution did not share an email
            address&rdquo; whatever this setting says.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection title="AFCT passwords">
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
        <p className="text-muted-foreground max-w-3xl text-sm">
          You can always set a password for someone yourself, whichever way this is set, so turning
          it off cannot leave anybody with no way back in. Note that the AFCT desktop client signs
          in with an email and a password, so a student who only ever opens AFCT from your LMS needs
          one to use it. With this off, an administrator who signs in through your institution also
          cannot confirm an LMS launch, which asks for an AFCT password.
        </p>
      </SettingsSection>
    </SettingsAsideLayout>
  );
}

export default SignInTab;
