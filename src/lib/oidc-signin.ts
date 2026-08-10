/**
 * Deciding which AFCT account an institutional (OIDC) sign-in belongs to.
 *
 * The rules live in {@link resolveFederatedSignIn}, shared with LTI. What is specific to OIDC is
 * when an address may be believed: the provider must assert it as verified, or an administrator
 * must have vouched for the provider. That escape hatch exists because some providers, Entra
 * among them, never send the claim at all.
 */

import { resolveFederatedSignIn } from '@/lib/federated-signin';
import type { AuditContext } from '@/lib/linked-identity';
export type { SignInRefusal, SignInOutcome } from '@/lib/federated-signin';
import type { SignInOutcome, SignInRefusal } from '@/lib/federated-signin';

/** What the provider told us about the person signing in. */
export type OidcClaims = {
  issuer: string;
  /** The provider's stable identifier (`sub`). */
  subject: string;
  email?: string | null;
  /** Whether the provider asserts the address is verified. */
  emailVerified?: boolean;
  firstName?: string | null;
  lastName?: string | null;
};

export async function resolveOidcSignIn(opts: {
  claims: OidcClaims;
  /** Whether an administrator has said this provider's addresses can be believed. */
  trustEmail: boolean;
  context: AuditContext;
}): Promise<SignInOutcome> {
  const { claims, trustEmail, context } = opts;

  return resolveFederatedSignIn({
    claims: {
      kind: 'OIDC',
      issuer: claims.issuer,
      subject: claims.subject,
      email: claims.email,
      // The OIDC-specific rule, decided here and passed on as a plain answer.
      emailTrusted: Boolean(claims.emailVerified) || trustEmail,
      firstName: claims.firstName,
      lastName: claims.lastName,
    },
    context,
  });
}

/** What to tell somebody who could not be signed in. Never says whether an account exists. */
export function refusalMessage(reason: SignInRefusal): string {
  switch (reason) {
    case 'no-email':
      return 'Your institution did not share an email address with AFCT, so we cannot sign you in. Ask an administrator to check the sign-in settings.';
    case 'email-not-verified':
      return 'Your institution did not confirm your email address. Ask an administrator to check the sign-in settings.';
    case 'admin-requires-deliberate-link':
      return 'This account is an administrator account and must be connected from inside AFCT. Sign in with your AFCT password, then connect your institution from your account page.';
    case 'already-linked-elsewhere':
      return 'That institutional login is already connected to a different AFCT account. Ask an administrator for help.';
    case 'account-inactive':
    default:
      return 'You cannot sign in at the moment. Ask an administrator for help.';
  }
}
