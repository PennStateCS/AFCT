/**
 * What an account can sign in with, and whether it may gain an AFCT password.
 *
 * Three callers need the same two answers and must not disagree about them: the page that
 * offers to set a password, the endpoint that writes one, and the email sent to somebody who
 * asked to reset a password they never had. Working it out separately in three places is how
 * a screen ends up offering an action the server refuses.
 *
 * The governing idea: an account has a set of ways in, a password being one of them and each
 * linked identity another. An account with none cannot be signed into at all, which is why
 * `unlinkIdentity` refuses to remove the last one.
 */

import { prisma } from '@/lib/prisma';
import { DEFAULT_ALLOW_LINKED_ACCOUNT_PASSWORDS } from '@/lib/system-settings';
import type { IdentityProviderKind } from '@prisma/client';

/** How this account can be signed into today. */
export type AccountCredentials = {
  hasPassword: boolean;
  /** The kinds of linked identity attached, deduplicated. Empty is possible; see below. */
  identityKinds: IdentityProviderKind[];
};

/**
 * Whether this install lets somebody who arrived through an institution or an LMS also set an
 * AFCT password for themselves.
 *
 * Reads the settings row, falling back to the default when there is none. A missing row is a
 * fresh install rather than a policy, and reading it as "not allowed" would withdraw the
 * feature exactly when nothing has been configured yet.
 */
export async function linkedAccountPasswordsAllowed(): Promise<boolean> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: 1 },
    select: { allowLinkedAccountPasswords: true },
  });
  return settings?.allowLinkedAccountPasswords ?? DEFAULT_ALLOW_LINKED_ACCOUNT_PASSWORDS;
}

/** What one account can currently sign in with. Never returns the password itself. */
export async function readAccountCredentials(userId: string): Promise<AccountCredentials | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { password: true, linkedIdentities: { select: { kind: true } } },
  });
  if (!user) return null;

  return {
    // Whether one exists, never anything about it.
    hasPassword: Boolean(user.password),
    identityKinds: [...new Set(user.linkedIdentities.map((identity) => identity.kind))],
  };
}

/**
 * Whether this person may give themselves a password right now.
 *
 * An account that already has one is not "allowed to set" it: changing a password is the other
 * path, and it requires the current one. The switch only ever governs *adding* a way in.
 */
export function canSetInitialPassword(opts: { hasPassword: boolean; allowed: boolean }): boolean {
  return !opts.hasPassword && opts.allowed;
}

/**
 * How to tell somebody the way into an account that has no password.
 *
 * Written as sentences rather than a code because both users of it put the answer in front of
 * a person: an email, and a line on the account page.
 *
 * **The administrator is always named**, whichever identities exist. Someone whose LMS access
 * has ended cannot act on "open AFCT from your LMS", and they are exactly the person most
 * likely to be reading this.
 */
export function describeHowToSignIn(kinds: IdentityProviderKind[]): string[] {
  const lines: string[] = [];
  if (kinds.includes('OIDC')) {
    lines.push('You sign in to AFCT with your institution’s account, from the AFCT sign-in page.');
  }
  if (kinds.includes('LTI')) {
    lines.push('You can open AFCT from your course in your LMS, which signs you in as you go.');
  }
  if (lines.length === 0) {
    // Possible, if rare: a roster sync creates the account and then declines to attach the LMS
    // identity because it already belongs to somebody else. Naming a way in that is not there
    // would be worse than saying only the thing that is always true.
    lines.push('This account does not have an AFCT password.');
  }
  lines.push(
    'An administrator can also give you an AFCT password if you need one, or if none of the above works.',
  );
  return lines;
}
