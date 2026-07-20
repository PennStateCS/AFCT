import { defineConfig } from 'vitest/config';
import path from 'path';

/**
 * Integration tests: real Postgres, no Prisma mock.
 *
 * The unit suite mocks Prisma at runtime, which is fast and covers most things but
 * structurally cannot answer questions about the *database*: whether two concurrent
 * conditional updates really serialize, whether a composite unique constraint actually
 * holds, whether a cascade fires. Those are the tests that belong here.
 *
 * Keep this suite small and about database behavior specifically. Anything provable
 * with a mock belongs in the unit suite, which needs no infrastructure.
 *
 * Run with `npm run test:integration` (resets + seeds afct_test first). These are
 * excluded from the default `vitest run`, so CI stays database-free.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.integration.test.ts'],
    setupFiles: ['src/test/integration-setup.ts'],
    // Concurrency tests coordinate on shared rows; running files in parallel against
    // one database makes failures depend on interleaving between unrelated suites.
    fileParallelism: false,
    // A real database round trip is slower than a mock, and the concurrency specs
    // deliberately wait on lock contention.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
});
