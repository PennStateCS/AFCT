'use client';

import { useCallback, useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Link2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { showToast } from '@/lib/toast';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

type LinkedIdentity = {
  id: string;
  kind: string;
  issuer: string;
  subject: string;
  linkedVia: string;
  createdAt: string;
  lastSignInAt: string | null;
};

/** Plain language for how a connection came about. Nobody outside the code says "just in time". */
const HOW_LINKED: Record<string, string> = {
  SELF_SERVICE: 'You connected this',
  AUTO_VERIFIED_EMAIL: 'Matched your email address',
  JUST_IN_TIME: 'Created when you first signed in',
  ADMIN: 'An administrator connected this',
};

/**
 * The institutional sign-ins connected to your own account.
 *
 * Connecting is a real sign-in to the provider, not a form: the point is to prove the account
 * over there belongs to whoever is signed in over here, and only the provider can say that.
 * So the button starts an ordinary OIDC flow and the callback attaches the result to the
 * current session.
 *
 * This is also the only route by which an administrator ever gets one, since automatic linking
 * refuses admin accounts by design.
 */
export function IdentitiesSection({ providerLabel }: { providerLabel: string | null }) {
  const { timezone, hour12 } = useEffectiveTimezone();
  const [identities, setIdentities] = useState<LinkedIdentity[] | null>(null);
  const [hasPassword, setHasPassword] = useState(true);
  const [unlinking, setUnlinking] = useState<LinkedIdentity | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/me/identities');
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { identities: LinkedIdentity[]; hasPassword: boolean };
      setIdentities(data.identities);
      setHasPassword(data.hasPassword);
    } catch {
      setIdentities([]);
      showToast.error('Could not load your connected accounts. Reload the page to try again.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The result of a connection attempt comes back as a query parameter, because the round trip
   * goes out to the provider and back. Read it once, tell them, then strip it so a reload does
   * not repeat the message.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.get('linked');
    const error = params.get('error');
    if (!linked && !error) return;

    if (linked) {
      showToast.success('Account connected. You can sign in with it from now on.');
    } else if (error === 'already-linked-elsewhere') {
      showToast.error('That institutional login is already connected to a different AFCT account.');
    } else {
      showToast.error('That account could not be connected. Try again.');
    }
    window.history.replaceState({}, '', window.location.pathname + '?tab=accounts');
    void load();
  }, [load]);

  const unlink = async () => {
    if (!unlinking) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/me/identities/${unlinking.id}`, { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast.error(data.error ?? 'Could not disconnect that account. Try again.');
        return;
      }
      showToast.success('Account disconnected.');
      setUnlinking(null);
      await load();
    } catch {
      showToast.error('Could not disconnect that account. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const label = providerLabel ?? 'your institution';
  // Removing the last one would lock them out, and the refusal belongs where the button is
  // rather than as a surprise after the click.
  const isOnlyWayIn = !hasPassword && (identities?.length ?? 0) <= 1;

  if (identities === null) {
    return <p className="text-muted-foreground text-sm">Loading your connected accounts...</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Connected accounts</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Sign in to AFCT with your institution instead of an AFCT password. You can connect one and
          still keep your password.
        </p>
      </div>

      {identities.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          You have not connected an institutional account.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {identities.map((identity) => (
            <li
              key={identity.id}
              className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{label}</p>
                <p className="text-muted-foreground truncate text-xs">
                  {HOW_LINKED[identity.linkedVia] ?? 'Connected'}
                  {' on '}
                  {formatDateTimeInTimeZone(identity.createdAt, timezone, hour12)}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {identity.lastSignInAt
                    ? `Last used ${formatDateTimeInTimeZone(identity.lastSignInAt, timezone, hour12)}`
                    : 'Not used to sign in yet'}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setUnlinking(identity)}
                disabled={isOnlyWayIn}
                title={
                  isOnlyWayIn
                    ? 'Set a password first, or you would not be able to sign in.'
                    : undefined
                }
              >
                <Unlink className="mr-2 h-4 w-4" aria-hidden="true" />
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}

      {isOnlyWayIn && identities.length > 0 && (
        <p className="text-muted-foreground text-sm">
          This is the only way to sign in to your account. Set a password on the Password tab before
          disconnecting it.
        </p>
      )}

      <Button
        onClick={() => void signIn('oidc', { callbackUrl: '/dashboard/account?tab=accounts' })}
      >
        <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
        Connect {label}
      </Button>

      <ConfirmDialog
        open={unlinking !== null}
        onCancel={() => setUnlinking(null)}
        title="Disconnect this account?"
        description={`You will no longer be able to sign in to AFCT with ${label}. You can connect it again at any time.`}
        confirmText="Disconnect"
        // Removes a way into the account, which is what this variant is for.
        variant="destructive"
        onConfirm={unlink}
        busy={busy}
      />
    </div>
  );
}
