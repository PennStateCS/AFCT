// Background auto-renewal for a Let's Encrypt certificate. Mirrors the
// activity-log-pruner: a guarded singleton that runs shortly after boot and then
// daily, renewing when the installed cert is within the renewal window. No-op
// unless a Let's Encrypt certificate is configured (see src/lib/acme.ts).

import { renewIfNeeded } from '@/lib/acme';

const DAY_MS = 24 * 60 * 60 * 1000;
const RENEW_INTERVAL_MS = DAY_MS; // check once a day
// Delay the first check so it doesn't race the rest of boot (DB, worker, etc.).
const FIRST_RUN_DELAY_MS = 60 * 1000;

let started = false;

async function checkOnce(): Promise<void> {
  try {
    const result = await renewIfNeeded();
    if (result.renewed) {
      console.log(`[tls-renewal] renewed certificate for ${result.domain}`);
    } else if (result.reason !== 'not-managed' && result.reason !== 'not-due') {
      // A real failure (issuance error), not "nothing to do".
      console.error(`[tls-renewal] renewal did not complete: ${result.reason}`);
    }
  } catch (error) {
    console.error('[tls-renewal] check failed:', error);
  }
}

async function loop(): Promise<void> {
  await checkOnce();
  setTimeout(() => void loop(), RENEW_INTERVAL_MS);
}

// Schedule the first check after a short delay, then daily. Safe to call more than once.
export function startTlsRenewal(): void {
  if (started) return;
  started = true;
  setTimeout(() => void loop(), FIRST_RUN_DELAY_MS);
}

// Exposed for unit tests only.
export const __test__ = { checkOnce };
