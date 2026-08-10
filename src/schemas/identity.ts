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
   * Must be an https URL, with no trailing slash. A path is fine and some providers need one
   * (Microsoft issuers carry a tenant, `.../tenant-id/v2.0`).
   *
   * The trailing slash matters because discovery appends a well-known path to whatever is
   * stored, and the resulting double slash is rejected by some providers and quietly 404s at
   * others. Refused rather than trimmed, so the admin corrects what they pasted instead of
   * wondering later why their copy does not match ours.
   */
  oidcIssuer: z
    .string()
    .trim()
    .max(255)
    .refine((v) => v === '' || /^https:\/\/[^\s/]+(?:\/[^\s?#/]+)*$/.test(v), {
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
