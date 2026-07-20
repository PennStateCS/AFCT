import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // `*.db.test.ts` needs a real Postgres and lives in its own project
    // (vitest.db.config.ts, run via `npm run test:db`). CI runs this config with no
    // database, so those must never be collected here.
    //
    // Note the deliberately distinct name: `*.integration.test.tsx` already exists in
    // this repo for component tests that render real primitives. Those need no database
    // and DO belong in this run, so keying the split on ".integration" alone would have
    // left the two telling apart only by file extension.
    exclude: ['**/node_modules/**', '**/*.db.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Vitest defaults to 5s. The userEvent-driven dialog tests take ~1.7s on an idle
    // machine, which sounds fine until 261 files run in parallel and they intermittently
    // cross 5s - producing 0, 1, 5 or 14 "failures" from identical code depending on
    // load. They are slow because userEvent yields to the event loop per keystroke, not
    // because anything is wrong, so give them room rather than chasing phantom bugs.
    testTimeout: 20_000,
    // Auto-restore env vars stubbed with vi.stubEnv between tests, so those stubs
    // need no manual teardown. (Globals are intentionally NOT auto-unstubbed:
    // some suites set a module-level vi.stubGlobal that must persist.)
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Still write the report when a test fails - a flaky test shouldn't
      // cost the whole coverage run.
      reportOnFailure: true,
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/.next/**',
        '**/coverage/**',

        'next.config.ts',
        'postcss.config.mjs',
        'prisma.config.ts',
        // Root-level lib holds the vendored java-runner.js (not TS, not unit-tested).
        // Scope this to root lib only; the previous 'lib/**' also excluded src/lib,
        // hiding the app's core logic (auth, security, submission worker) from coverage.
        'lib/*.js',
        'prisma/**',

        'src/env.mjs',
        'src/types/**',
        'src/app/fonts.ts',
        'src/app/**/layout.tsx',
        'src/app/**/page.tsx',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
