import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test/setup.ts'],
    // Auto-restore env vars stubbed with vi.stubEnv between tests, so those stubs
    // need no manual teardown. (Globals are intentionally NOT auto-unstubbed:
    // some suites set a module-level vi.stubGlobal that must persist.)
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
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
        // Scope this to root lib only — the previous 'lib/**' also excluded src/lib,
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
