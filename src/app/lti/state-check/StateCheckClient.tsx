'use client';

import { useEffect, useRef } from 'react';
import { getData, stateStorageKey } from '@/lib/lti/platform-storage';

/**
 * Asking the platform what it kept for this launch, because the browser sent no cookie.
 *
 * The launch is already waiting on the server; all that is missing is proof it belongs to this
 * browser. The platform's storage holds that, and only a page can read it, which is why this
 * step exists at all. It posts what it finds straight back rather than deciding anything here:
 * the comparison belongs on the server, where the launch it is about lives.
 */
export default function StateCheckClient({
  state,
  storageTarget,
  platformOrigin,
}: {
  state: string;
  storageTarget: string | null;
  platformOrigin: string | null;
}) {
  const form = useRef<HTMLFormElement>(null);
  const stored = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const go = async () => {
      const value = await getData({
        key: stateStorageKey(state),
        storageTarget,
        platformOrigin,
      });
      // Submitted even when nothing came back, so the refusal comes from the server with one
      // wording rather than from two places that could disagree.
      if (stored.current) stored.current.value = value ?? '';
      form.current?.submit();
    };
    void go();
  }, [state, storageTarget, platformOrigin]);

  return (
    <main className="text-muted-foreground p-6 text-sm" aria-live="polite">
      Checking your launch…
      <form ref={form} method="POST" action="/api/lti/launch/state">
        <input type="hidden" name="state" value={state} />
        <input ref={stored} type="hidden" name="stored" defaultValue="" />
        <noscript>
          <p className="mt-2">
            This step needs JavaScript, because only your browser can answer for this launch.
          </p>
        </noscript>
      </form>
    </main>
  );
}
