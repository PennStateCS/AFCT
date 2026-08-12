'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

/**
 * Spends the launch ticket and lands the person in AFCT.
 *
 * Runs once. Tickets are single use, so a second attempt would fail on a page that had already
 * succeeded, which is the sort of thing React's development double-render produces.
 *
 * A reload is the same problem across a fresh mount, where the ref below is no help: the ticket
 * is spent, the person is signed in, and they were being told AFCT could not open. So a launch
 * that succeeds leaves a marker and a reload follows it instead of signing in again. Keyed by
 * the ticket rather than a bare flag, so it can only ever skip the launch it belongs to: on a
 * shared browser, the next person's ticket has no marker and is spent normally.
 */
const completedKey = (ticket: string) => `lti-launch-done:${ticket}`;

/** Storage is unavailable in some privacy modes, and a launch must not depend on it. */
function remember(key: string): void {
  try {
    sessionStorage.setItem(key, '1');
  } catch {
    // Ignored: the only cost is that a reload shows the error again.
  }
}

function alreadyDone(key: string): boolean {
  try {
    return sessionStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export default function CompleteLaunchClient() {
  const params = useSearchParams();
  const ticket = params.get('ticket');
  /**
   * Where to go once signed in, chosen by the launch endpoint.
   *
   * Only a path on this site is accepted. The value reaches here through the browser, so
   * without this check a crafted link would turn a launch into an open redirect, which is worth
   * something to anyone phishing a university.
   */
  const requested = params.get('next');
  const next = requested && /^\/(?!\/)/.test(requested) ? requested : '/dashboard';
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!ticket) {
      setFailed(true);
      return;
    }

    // Already spent by this browser, on a launch that worked. Go where it was going.
    const key = completedKey(ticket);
    if (alreadyDone(key)) {
      window.location.replace(next);
      return;
    }

    // `redirect: false` so a bad ticket lands back here with a message, rather than bouncing to
    // NextAuth's own error page, which says nothing useful to somebody inside an LMS.
    void signIn('lti-launch', { ticket, redirect: false })
      .then((result) => {
        if (result?.error) {
          setFailed(true);
          return;
        }
        remember(key);
        window.location.replace(next);
      })
      // Without this, a rejected sign-in leaves the page saying "Opening AFCT..." for ever,
      // which is the worst of the possible failures: it looks like a hang rather than an error,
      // and there is nothing on screen to report.
      .catch((error) => {
        console.error('[lti] could not complete the launch:', error);
        setFailed(true);
      });
  }, [ticket, next]);

  return (
    <main className="flex min-h-screen w-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        {failed ? (
          <>
            <h1 className="text-lg font-medium">AFCT could not open</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Go back to your LMS and open the link again. If it keeps happening, ask an
              administrator to check the AFCT registration.
            </p>
          </>
        ) : (
          // Announced, because for anyone using a screen reader this is an otherwise silent wait.
          <p role="status" aria-live="polite" className="text-muted-foreground text-sm">
            Opening AFCT...
          </p>
        )}
      </div>
    </main>
  );
}
