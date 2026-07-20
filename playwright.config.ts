import { defineConfig, devices } from '@playwright/test';

/**
 * Browser-level smoke suite.
 *
 * This exists to cover the one thing the ~2300 Vitest tests structurally cannot: those
 * mock Prisma at the route boundary, so they prove each piece works in isolation but
 * never that auth, the database, file storage, and the UI are wired to each other.
 * These specs drive a real browser against a real server against a real database.
 *
 * It is deliberately small. A smoke suite that takes ten minutes and flakes twice a
 * week gets ignored; five reliable workflows that fail only when something is actually
 * broken get trusted. Resist the urge to grow this into a full regression suite -
 * anything that can be tested with mocks belongs in Vitest.
 *
 * Runs against a SEPARATE `afct_test` database (see scripts/e2e-db.mjs), never your
 * dev data, and on port 3100 so it does not collide with the dev stack on 3000.
 */

const PORT = 3100;
const baseURL = `http://localhost:${PORT}`;

const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://afct_user:afct_pass@localhost:5432/afct_test';

export default defineConfig({
  testDir: './e2e',
  // Each spec drives a multi-step workflow through a real browser; the default 30s
  // is tight once a page has to compile, query, and hydrate.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // Serial. These specs share one database and several of them mutate global state
  // (creating courses, enrolling students), so running them in parallel would make
  // them depend on each other's timing. Speed is not the point here.
  fullyParallel: false,
  workers: 1,

  // A retry masks flake, and flake in a smoke suite is itself the bug. Fail loudly.
  retries: 0,
  forbidOnly: !!process.env.CI,

  reporter: [['list'], ['html', { outputFolder: 'e2e-report', open: 'never' }]],

  use: {
    baseURL,
    // Artifacts only for failures: enough to diagnose without filling the disk.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // Dev server, not a production build, and the reason is not convenience:
    //
    // proxy.ts reads the session cookie with `secureCookie: NODE_ENV === 'production'`,
    // so a production build looks for the `__Secure-`-prefixed cookie. Auth.js only
    // WRITES that prefixed cookie when the URL is https. Serving a production build
    // over plain http therefore writes one cookie name and reads another, and every
    // /dashboard hit redirect-loops until the browser gives up. Real deployments are
    // https behind nginx, so the two agree there; it is only this harness that would
    // have to fake it.
    //
    // The tradeoff to know about: dev mode means CSP is Report-Only rather than
    // enforced, so these specs cannot catch a CSP regression. If that ever matters,
    // the fix is to serve the suite over TLS, not to loosen the proxy.
    command: `npx next dev -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    // Dev compiles routes on first hit, and the first compile is the slow one.
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      DATABASE_URL,
      // Must match the port above or NextAuth builds its callback URLs against the
      // wrong origin and every sign-in silently fails.
      NEXTAUTH_URL: baseURL,
      // Test-only signing key for a throwaway local server. Not a real secret, and
      // deliberately not read from .env.development so a developer's local secret
      // never leaks into test artifacts. The app enforces a 32-character minimum,
      // so this padding is load-bearing, not decoration.
      NEXTAUTH_SECRET:
        process.env.E2E_NEXTAUTH_SECRET ?? 'e2e-only-not-a-real-secret-0000000000000000',
      NODE_ENV: 'development',
    },
  },
});
