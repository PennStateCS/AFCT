/**
 * Deciding which AFCT account a launch belongs to.
 *
 * The rules are shared with institutional sign-in. What is specific to LTI is that the address
 * is trusted: a launch can only come from a platform an administrator registered, signed by that
 * platform's key, and the LMS is the institution's own record of who its people are.
 *
 * The administrator rule does not relax with it. An AFCT admin account is never attached
 * automatically, however trustworthy the source; admins connect from their own account page.
 */

import { resolveFederatedSignIn } from '@/lib/federated-signin';
import type { AuditContext } from '@/lib/linked-identity';
import type { SignInOutcome, SignInRefusal } from '@/lib/federated-signin';
import type { LaunchIdentity } from '@/lib/lti/launch';

export async function resolveLaunchSignIn(opts: {
  identity: LaunchIdentity;
  context: AuditContext;
}): Promise<SignInOutcome> {
  const { identity, context } = opts;

  return resolveFederatedSignIn({
    claims: {
      kind: 'LTI',
      // The platform's issuer, not the registration id: a second deployment of the same LMS is
      // still the same person.
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      emailTrusted: true,
      firstName: identity.firstName,
      lastName: identity.lastName,
    },
    context,
  });
}

/** What to tell somebody whose launch was verified but could not be signed in. */
export function launchSignInRefusalMessage(reason: SignInRefusal): string {
  switch (reason) {
    case 'admin-requires-deliberate-link':
      return 'This is an AFCT administrator account, which must be connected deliberately. Sign in to AFCT directly, then connect your institution from your account page.';
    case 'already-linked-elsewhere':
      return 'Your LMS account is already connected to a different AFCT account. Ask an administrator for help.';
    case 'account-inactive':
      return 'Your AFCT account has been deactivated. Ask an administrator for help.';
    case 'no-email':
    case 'email-not-verified':
    default:
      return 'Your LMS did not share an email address with AFCT, so you cannot be signed in. An administrator needs to allow AFCT to see email addresses in the LMS privacy settings.';
  }
}
