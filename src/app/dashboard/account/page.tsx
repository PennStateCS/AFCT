import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getOidcConfig } from '@/lib/oidc-provider';
import AccountClient from './AccountClient';

export const metadata: Metadata = {
  title: 'Account',
};

/**
 * Your own account. Every signed-in user has one, so unlike the admin pages this is gated on
 * being signed in at all rather than on a role.
 *
 * The user comes from the session rather than a fetch, so the form is filled on first paint.
 * The profile form updates the session after a save, which is what refreshes the avatar in the
 * sidebar without a reload.
 */
export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  // Read here rather than in the component so the Connected accounts tab is right on first
  // paint, instead of appearing a moment after the page settles.
  const oidc = await getOidcConfig();

  return (
    <AccountClient
      user={session.user}
      oidcAvailable={oidc !== null}
      oidcLabel={oidc?.buttonLabel ?? null}
    />
  );
}
