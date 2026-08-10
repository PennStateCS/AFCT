'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';

/**
 * Spends the launch ticket and lands the person in AFCT.
 *
 * Runs once. Tickets are single use, so a second attempt would fail on a page that had already
 * succeeded, which is the sort of thing React's development double-render produces.
 */
export default function CompleteLaunchClient() {
  const params = useSearchParams();
  const ticket = params.get('ticket');
  const started = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    if (!ticket) {
      setFailed(true);
      return;
    }

    // `redirect: false` so a bad ticket lands back here with a message, rather than bouncing to
    // NextAuth's own error page, which says nothing useful to somebody inside an LMS.
    void signIn('lti-launch', { ticket, redirect: false }).then((result) => {
      if (result?.error) {
        setFailed(true);
        return;
      }
      window.location.replace('/dashboard');
    });
  }, [ticket]);

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
