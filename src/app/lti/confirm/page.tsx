import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'Confirm it is you',
};

/**
 * An administrator proving the account is theirs before their LMS is attached to it.
 *
 * Reached only from a launch that matched an AFCT administrator by email. Automatic linking is
 * refused there because the match rests on an address the LMS asserts, and AFCT cannot see how
 * carefully that address was verified: for a student a wrong match exposes one person's work,
 * for an administrator it hands over every student record in the system.
 *
 * A password closes that gap, because it is the one thing an LMS cannot assert. Anybody who can
 * supply it could sign in as this account anyway, so the link becomes deliberate rather than a
 * new way in.
 *
 * A plain form, like the rest of the LTI flow, so it works with no client JavaScript.
 */
export default async function ConfirmIdentityPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string; error?: string }>;
}) {
  const { pending: pendingId, error } = await searchParams;

  const pending = pendingId
    ? await prisma.ltiPendingIdentityLink.findFirst({
        where: { id: pendingId, expiresAt: { gt: new Date() } },
        select: { id: true, user: { select: { email: true } } },
      })
    : null;

  if (!pending) {
    return (
      <Shell title="This request has expired">
        <p className="text-muted-foreground text-sm">
          Go back to your LMS and open AFCT again.
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Confirm it is you">
      <p className="text-muted-foreground mb-4 text-sm">
        {pending.user.email} is an AFCT administrator account. Enter its AFCT password to connect
        your LMS account to it. You are only asked once.
      </p>

      {error ? (
        // Deliberately the same words whether the password was wrong or the account is not
        // usable: this page is reachable by anyone holding a launch, so it must not report
        // which part failed.
        <p role="alert" className="text-destructive mb-4 text-sm">
          That password was not accepted. Try again, or go back to your LMS and start over.
        </p>
      ) : null}

      <form method="POST" action="/api/lti/confirm-identity" className="space-y-4">
        <input type="hidden" name="pendingId" value={pending.id} />

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium">
            AFCT password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            autoFocus
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          />
        </div>

        <button
          type="submit"
          className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
        >
          Connect and continue
        </button>
      </form>

      <p className="text-muted-foreground mt-4 text-xs">
        Connecting lets you open AFCT from your LMS without signing in again. It does not change
        what your LMS can do, and it can be removed from your account page.
      </p>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh w-full items-center justify-center p-4">
      <div className="bg-card max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border p-6">
        <h1 className="mb-3 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}
