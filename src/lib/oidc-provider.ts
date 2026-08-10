/**
 * The institutional sign-in provider, built from stored settings.
 *
 * NextAuth normally takes its providers from a static config, but this one is configured by an
 * administrator at runtime, so `auth.ts` asks for it per request. Returning null when it is not
 * configured is what keeps an install that uses only local accounts exactly as it was: the
 * provider does not exist, so no route, button or callback for it does either.
 */

import type { OIDCConfig } from 'next-auth/providers';
import { prisma } from '@/lib/prisma';
import { readStoredSecret, SecretKeyError } from '@/lib/secret-encryption';

/** The stable id the provider is known by, in callback URLs and in `signIn('oidc')`. */
export const OIDC_PROVIDER_ID = 'oidc';

export type OidcRuntimeConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  buttonLabel: string | null;
  /** Whether an administrator has said this provider's addresses can be believed. */
  trustEmail: boolean;
};

/**
 * Read the configuration, or null when institutional sign-in is off or incomplete.
 *
 * Never throws. This is called while building the auth config on ordinary requests, including
 * requests that have nothing to do with signing in, so a misconfiguration must degrade to "not
 * available" rather than take the whole site down. The Sign-in tab is where an admin finds out
 * something is wrong; the sign-in page is not the place to discover it.
 */
export async function getOidcConfig(): Promise<OidcRuntimeConfig | null> {
  try {
    const s = await prisma.systemSettings.findUnique({
      where: { id: 1 },
      select: {
        oidcEnabled: true,
        oidcIssuer: true,
        oidcClientId: true,
        oidcClientSecret: true,
        oidcButtonLabel: true,
        oidcTrustEmail: true,
      },
    });

    if (!s?.oidcEnabled || !s.oidcIssuer || !s.oidcClientId || !s.oidcClientSecret) return null;

    const clientSecret = readStoredSecret(s.oidcClientSecret);
    if (!clientSecret) return null;

    return {
      issuer: s.oidcIssuer,
      clientId: s.oidcClientId,
      clientSecret,
      buttonLabel: s.oidcButtonLabel,
      trustEmail: s.oidcTrustEmail,
    };
  } catch (error) {
    // A missing encryption key lands here. Reported, not thrown: the alternative is every page
    // on the site failing because one optional feature cannot read one setting.
    if (error instanceof SecretKeyError) {
      console.error('[oidc] client secret could not be read:', error.message);
    } else {
      console.error('[oidc] configuration could not be read:', error);
    }
    return null;
  }
}

/**
 * The provider definition NextAuth needs.
 *
 * PKCE and state are on: PKCE because it is the current standard for any client that can do it,
 * and both because the alternative is trusting the redirect not to have been tampered with.
 */
export function buildOidcProvider(config: OidcRuntimeConfig): OIDCConfig<Record<string, unknown>> {
  return {
    id: OIDC_PROVIDER_ID,
    name: config.buttonLabel ?? 'Institution',
    type: 'oidc',
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    checks: ['pkce', 'state'],
    // Only what is needed to identify a person. Asking for more than that is how an
    // integration ends up holding data nobody agreed to hand over.
    authorization: { params: { scope: 'openid email profile' } },
  };
}
