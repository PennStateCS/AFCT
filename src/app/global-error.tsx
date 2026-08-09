'use client';

import { useEffect } from 'react';
import { ErrorPageShell } from '@/components/ErrorPageShell';

/**
 * The root layout itself failing.
 *
 * This replaces the layout rather than rendering inside it, so it has to supply its own
 * `<html>` and `<body>`, and it cannot assume any provider the app normally sets up. The
 * markup here is deliberately plain for the same reason: whatever this screen depends on is
 * something that can also be broken when it is needed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Root layout error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <ErrorPageShell
          title="AFCT could not start this page"
          description="Something failed before the page could be drawn. Reloading usually clears it; if it keeps happening, quote the reference code below."
          digest={error.digest}
          actions={
            <button
              type="button"
              onClick={reset}
              className="bg-primary text-primary-foreground inline-flex h-11 items-center justify-center rounded-md px-6 text-sm font-medium"
            >
              Reload the page
            </button>
          }
        />
      </body>
    </html>
  );
}
