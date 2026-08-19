import { z } from 'zod';

/**
 * Institutional sign-in settings (OIDC).
 *
 * The same schema backs the form and the route, so the browser and the server cannot disagree
 * about what is valid. The issuer is the only field with real validation to do: everything else
 * about the provider is discovered from it, so a wrong issuer is the failure that produces the
 * most confusing symptoms later.
 */
export const OidcSettingsSchema = z.object({
  oidcEnabled: z.boolean().optional(),
  /**
   * The issuer exactly as the provider advertises it.
   *
   * Stored verbatim, including a trailing slash: the issuer is an identifier, it is compared
   * against the `iss` claim character by character, and some providers really do publish one
   * that ends in `/` (Auth0 tenants among them). Rejecting those, as this used to, made AFCT
   * unusable with them; normalising them would break the comparison instead.
   *
   * A path is fine and some providers need one (Microsoft issuers carry a tenant,
   * `.../tenant-id/v2.0`). No query or fragment: OIDC Discovery forbids both.
   */
  oidcIssuer: z
    .string()
    .trim()
    .max(255)
    .refine((v) => v === '' || /^https:\/\/[^\s/?#]+(?:\/[^\s?#/]+)*\/?$/.test(v), {
      message: 'Enter the provider’s issuer URL, for example https://login.your-university.edu.',
    })
    .optional(),
  oidcClientId: z.string().trim().max(255).optional(),
  /** Write-only, like every other stored secret: empty means keep, clearing is explicit. */
  oidcClientSecret: z.string().optional(),
  oidcClientSecretClear: z.boolean().optional(),
  oidcButtonLabel: z.string().trim().max(60).optional(),
  oidcTrustEmail: z.boolean().optional(),
});

export type OidcSettingsInput = z.infer<typeof OidcSettingsSchema>;

/** What the button says when an admin has not chosen wording. */
export const DEFAULT_OIDC_BUTTON_LABEL = 'Sign in with your institution';
