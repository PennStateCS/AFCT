import { request, type FullConfig } from '@playwright/test';

/**
 * Compile the sign-in path before any spec runs.
 *
 * The suite runs against `next dev`, which compiles a route the first time it is hit. The
 * first request to the credentials endpoint therefore takes seconds, and NextAuth answers a
 * request it could not complete in time the same way it answers a wrong password: "Email or
 * password is incorrect". So the first sign-in of a run fails, and it fails as though the
 * seeded password were wrong, which is a genuinely misleading thing to debug.
 *
 * It only bites when the machine is slow enough, which is why the suite passed locally and
 * failed on a CI runner. Warming the route here removes the difference rather than papering
 * over it with a retry: `playwright.config.ts` deliberately sets `retries: 0` on the grounds
 * that flake in a smoke suite is itself the bug, and that stays true.
 *
 * The credentials POST below is expected to be rejected - it sends nothing usable. Being
 * rejected is the point: the route has compiled by the time it answers.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) return;

  const api = await request.newContext({ baseURL });
  try {
    // The page itself, and the CSRF endpoint the form posts against.
    await api.get('/login').catch(() => {});
    await api.get('/api/auth/csrf').catch(() => {});

    // The expensive one: the credentials callback, which pulls in the auth stack.
    await api
      .post('/api/auth/callback/credentials', {
        form: { email: 'warmup@example.invalid', password: 'not-a-real-password' },
        // A rejection is the expected outcome; only the compile matters.
        failOnStatusCode: false,
        timeout: 120_000,
      })
      .catch(() => {});
  } finally {
    await api.dispose();
  }
}
