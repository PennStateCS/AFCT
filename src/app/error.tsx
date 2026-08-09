'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, Home, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorPageShell } from '@/components/ErrorPageShell';

/**
 * Whatever a page throws while rendering.
 *
 * It says what to do rather than what failed: the message and stack stay on the server, and
 * the reference code is what connects this screen to that log entry. The operators here are
 * professors, not engineers, so "try again, then tell us this code" is more use than a
 * message they cannot act on.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server log has the real thing; this is for whoever has the browser console open.
    console.error('Route error:', error);
  }, [error]);

  return (
    <ErrorPageShell
      title="Something went wrong"
      description="The page could not be loaded. Trying again often works; if it does not, the reference code below identifies what happened."
      digest={error.digest}
      actions={
        <>
          <Button size="lg" onClick={reset}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/dashboard">
              <Home className="mr-2 h-4 w-4" aria-hidden="true" />
              Go to dashboard
              <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        </>
      }
    />
  );
}
