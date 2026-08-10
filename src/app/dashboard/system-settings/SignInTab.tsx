'use client';

import { Badge } from '@/components/ui/badge';
import InputGroup from '@/components/ui/InputGroup';
import SwitchField from '@/components/ui/SwitchField';
import { DEFAULT_OIDC_BUTTON_LABEL } from '@/schemas/identity';
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
  setField,
  disabled,
  clientSecret,
  setClientSecret,
  clientSecretConfigured,
  clientSecretClear,
  setClientSecretClear,
  redirectUri,
}: {
  enabled: boolean;
  issuer: string;
  clientId: string;
  buttonLabel: string;
  trustEmail: boolean;
  setField: SetField;
  disabled: boolean;
  clientSecret: string;
  setClientSecret: (value: string) => void;
  clientSecretConfigured: boolean;
  clientSecretClear: boolean;
  setClientSecretClear: (value: boolean) => void;
  /** What the identity provider must be told to allow. Read-only; derived from the site URL. */
  redirectUri: string;
}) {
  return (
    <>
      <p className="text-muted-foreground mb-4 text-sm">
        Let people sign in with their institution&apos;s account. Your IT department will give you
        these values, and will need the redirect URL below.
      </p>

      <div className="mb-5 space-y-2">
        <h2 className="text-sm font-medium">Current status</h2>
        <div className="bg-muted w-fit max-w-2xl space-y-2 rounded-md border p-3 text-sm">
          <Badge variant={enabled ? 'success' : 'warning'} className="w-fit">
            {enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <p className="text-muted-foreground">
            {enabled
              ? 'People can sign in with their institution. AFCT passwords still work as well.'
              : 'Everyone signs in with an AFCT password.'}
          </p>
        </div>
      </div>

      <div className="max-w-md space-y-5">
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
          description="Everything else is discovered from this. No trailing slash."
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

      <div className="mt-6 max-w-md space-y-3 border-t pt-5">
        <h2 className="text-sm font-medium">Give this to your IT department</h2>
        <p className="text-muted-foreground text-xs">
          The redirect URL AFCT will use. Registration usually fails without it, with an error
          about a mismatched redirect.
        </p>
        <InputGroup
          label="Redirect URL"
          name="oidcRedirectUri"
          value={redirectUri}
          setValue={() => {}}
          readOnly
        />
      </div>

      <div className="mt-6 max-w-md space-y-3 border-t pt-5">
        <h2 className="text-sm font-medium">Matching people to accounts</h2>
        <p className="text-muted-foreground text-xs">
          When somebody signs in for the first time, AFCT attaches their institutional identity
          to an existing account with the same email address, but only if the provider states
          that the address is verified.
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
          Some providers, including Microsoft Entra, never mark addresses as verified. Without
          this, nobody at those institutions is matched automatically. With it on at a provider
          where people can choose their own address, someone could reach an account that is not
          theirs. Administrator accounts are never matched automatically either way.
        </p>
      </div>
    </>
  );
}

export default SignInTab;
