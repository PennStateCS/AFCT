'use client';

import { useCallback, useEffect, useState } from 'react';
import { Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { showToast } from '@/lib/toast';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

type Identity = {
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
  SELF_SERVICE: 'They connected it themselves',
  AUTO_VERIFIED_EMAIL: 'Matched their email address',
  JUST_IN_TIME: 'Created when they first signed in',
  ADMIN: 'Connected by an administrator',
};

const KIND: Record<string, string> = {
  OIDC: 'Institutional sign-in',
  LTI: 'Opened from an LMS',
};

/**
 * How somebody signs in, for an administrator.
 *
 * Exists to answer "why can this person not get in", which otherwise needs a look at the
 * database. Nothing here is secret: an issuer and a subject name a person to a provider,
 * they do not authenticate anybody.
 */
export function UserIdentitiesDialog({
  userId,
  userName,
  open,
  setOpen,
}: {
  userId: string;
  userName: string;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { timezone, hour12 } = useEffectiveTimezone();
  const [identities, setIdentities] = useState<Identity[] | null>(null);
  const [hasPassword, setHasPassword] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIdentities(null);
    try {
      const res = await fetch(`/api/users/${userId}/identities`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { identities: Identity[]; hasPassword: boolean };
      setIdentities(data.identities);
      setHasPassword(data.hasPassword);
    } catch {
      setIdentities([]);
      showToast.error('Could not load their sign-in methods.');
    }
  }, [userId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const unlink = async (identity: Identity) => {
    setBusy(identity.id);
    try {
      const res = await fetch(`/api/users/${userId}/identities?identityId=${identity.id}`, {
        method: 'DELETE',
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showToast.error(data.error ?? 'Could not detach that. Try again.');
        return;
      }
      showToast.success('Sign-in method detached.');
      await load();
    } catch {
      showToast.error('Could not detach that. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const onlyWayIn = !hasPassword && (identities?.length ?? 0) <= 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>How {userName} signs in</DialogTitle>
          <DialogDescription>
            {hasPassword
              ? 'They have an AFCT password, plus anything listed here.'
              : 'They have no AFCT password, so they can only sign in with what is listed here.'}
          </DialogDescription>
        </DialogHeader>

        {identities === null ? (
          <p className="text-muted-foreground text-sm">Loading...</p>
        ) : identities.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing is connected. They sign in with their AFCT password.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {identities.map((identity) => (
              <li
                key={identity.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{KIND[identity.kind] ?? identity.kind}</p>
                  <p className="text-muted-foreground truncate text-xs">{identity.issuer}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {HOW_LINKED[identity.linkedVia] ?? 'Connected'}
                    {' on '}
                    {formatDateTimeInTimeZone(identity.createdAt, timezone, hour12)}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {identity.lastSignInAt
                      ? `Last used ${formatDateTimeInTimeZone(identity.lastSignInAt, timezone, hour12)}`
                      : 'Never used to sign in'}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void unlink(identity)}
                  disabled={onlyWayIn || busy === identity.id}
                  title={
                    onlyWayIn
                      ? 'Give them a password first, or they would not be able to sign in.'
                      : undefined
                  }
                >
                  <Unlink className="mr-2 h-4 w-4" aria-hidden="true" />
                  Detach
                </Button>
              </li>
            ))}
          </ul>
        )}

        {onlyWayIn && (identities?.length ?? 0) > 0 && (
          <p className="text-muted-foreground text-sm">
            This is the only way they can sign in, so it cannot be detached. Give them a password
            first.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
