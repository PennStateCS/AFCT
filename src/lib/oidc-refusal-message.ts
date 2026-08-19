/**
 * What to tell somebody whose institutional sign-in was refused.
 *
 * The callback puts a fixed word on the URL rather than a message, so nothing a provider says
 * reaches the page as text. Each of these is something the person or their administrator can
 * act on, which is the whole reason for telling them apart: "invalid email or password" sent
 * people back to retype a password that was never the problem.
 *
 * None of them says whether an AFCT account exists. "Already connected elsewhere" comes closest
 * and is unavoidable, since it is the one case where the person must be told to ask for help
 * rather than try again.
 */
export function oidcRefusalMessage(reason: string | null): string {
  switch (reason) {
    case 'no-email':
      return 'Your institution did not share an email address with AFCT, so it could not sign you in. Ask an administrator to allow AFCT to see your address.';
    case 'email-not-verified':
      return 'Your institution did not confirm your email address, so AFCT could not sign you in. An administrator can change this in the AFCT sign-in settings.';
    case 'account-inactive':
      return 'That account is not available. Ask an administrator for help.';
    case 'admin-requires-deliberate-link':
      return 'Administrator accounts are not connected automatically. Sign in with your AFCT password, then connect your institution from your account page.';
    case 'already-linked-elsewhere':
      return 'Your institutional account is already connected to a different AFCT account. Ask an administrator for help.';
    default:
      return 'AFCT could not sign you in with your institution. Try again, or sign in with your AFCT password.';
  }
}
