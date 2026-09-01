// lib/prisma.ts

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Use a global singleton in development to avoid creating multiple Prisma instances on reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Create a Prisma client with query logging enabled
/**
 * How many database connections this process may hold.
 *
 * Stated rather than inherited. The driver's own default is 10, which is fine until you count
 * the processes: the app, the submission worker, the backup sidecar, a database test run, and
 * anything an administrator has open all hold a pool of their own, busy or idle. Multiply that
 * by a default nobody chose and the ceiling arrives without warning, at which point the app
 * cannot run its startup migration and the failure looks like anything but a resource limit.
 *
 * It is per process and unrelated to how many people are using AFCT: a course of three hundred
 * costs the same as an empty one. Raise it for a deployment that genuinely runs out of pool
 * under load, and keep `processes * this` comfortably under the server's `max_connections`
 * (200 in deploy/docker-compose.yml).
 */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 10);

const createPrismaClient = () => {
  // Prisma 7 uses driver adapters (no bundled query engine); the connection URL
  // now comes from the adapter rather than the schema's datasource block.
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    max: Number.isFinite(POOL_MAX) && POOL_MAX > 0 ? POOL_MAX : 10,
  });
  const client = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'info' },
      { emit: 'stdout', level: 'warn' },
    ],
  });

  // Slow-query logging, in development only.
  //
  // Loaded dynamically rather than imported at the top of this file. That module needs a package
  // which is a devDependency, and the production image installs with `npm ci --omit=dev`. The
  // submission worker runs this source through tsx instead of a bundle, so a static import of
  // something absent from the production image crashes it on startup; that is how v0.9.4 failed
  // to deploy. A dynamic import inside this branch is never evaluated in production.
  if (process.env.NODE_ENV === 'development') {
    void import('@/lib/dev-query-log')
      .then((m) => m.attachSlowQueryLog(client))
      .catch((err) => {
        // Never fatal: this is a convenience. Say so rather than failing silently, since a dev
        // tool that quietly stops working is how the original problem stayed hidden.
        console.warn('[prisma] slow-query logging unavailable:', err);
      });
  }

  return client;
};

// Initialize Prisma
export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Cache the Prisma client globally in development
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// NOTE: the submission worker is NOT started here. It runs as its own process — the
// `worker` service (src/worker.ts) in both docker-compose.dev.yml and
// deploy/docker-compose.yml — so it starts exactly once and, in prod, in a
// network-isolated container. (It used to be kicked from here as a workaround for
// `next dev --webpack` skipping instrumentation.ts, but that re-started it per webpack
// bundle context and stacked DB pollers.)
