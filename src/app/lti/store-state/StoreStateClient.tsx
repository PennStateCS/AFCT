'use client';

import { useEffect } from 'react';
import { getData, putData, stateStorageKey } from '@/lib/lti/platform-storage';

/**
 * The step between the LMS starting a launch and the platform authorising it.
 *
 * It exists to put one value somewhere the browser will keep: the launch's state, in the
 * platform's own storage. A browser that blocks third-party cookies drops AFCT's state cookie,
 * and without either of them a returning launch cannot be tied to the browser that began it and
 * is refused. This page is the difference between Safari working and Safari not.
 *
 * It carries on to the platform whatever happens. If the platform does not answer, the cookie
 * may well be fine, and stopping here to explain a storage failure would break launches that
 * were going to succeed.
 */
export default function StoreStateClient({
  state,
  authorizeUrl,
  storageTarget,
  platformOrigin,
}: {
  state: string;
  authorizeUrl: string;
  storageTarget: string | null;
  platformOrigin: string | null;
}) {
  useEffect(() => {
    let cancelled = false;

    const go = async () => {
      const key = stateStorageKey(state);
      await putData({ key, value: state, storageTarget, platformOrigin });
      // Read back rather than trust the acknowledgement. A platform that answers put_data and
      // stores nothing would otherwise send the launch on to fail its state check later, where
      // the cause is invisible; this at least records the truth in the console.
      const stored = await getData({ key, storageTarget, platformOrigin });
      if (stored !== state) {
        console.warn('[lti] the platform did not keep the launch state; relying on the cookie');
      }
      if (!cancelled) window.location.replace(authorizeUrl);
    };

    void go();
    return () => {
      cancelled = true;
    };
  }, [state, authorizeUrl, storageTarget, platformOrigin]);

  // Seen for a fraction of a second, inside an LMS frame, and only for longer than that when
  // something is wrong. So it says what is happening rather than showing a spinner alone.
  return (
    <main className="text-muted-foreground p-6 text-sm" aria-live="polite">
      Connecting to your LMS…
      <noscript>
        <p className="mt-2">
          This step needs JavaScript. <a href={authorizeUrl}>Continue to your LMS</a>.
        </p>
      </noscript>
    </main>
  );
}
