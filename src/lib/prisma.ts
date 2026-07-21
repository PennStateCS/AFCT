// lib/prisma.ts

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { format } from 'sql-formatter';
import chalk from 'chalk';

// Use a global singleton in development to avoid creating multiple Prisma instances on reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  devWorkerStarted: boolean | undefined;
};

// Create a Prisma client with query logging enabled
const createPrismaClient = () => {
  // Prisma 7 uses driver adapters (no bundled query engine); the connection URL
  // now comes from the adapter rather than the schema's datasource block.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const client = new PrismaClient({
    adapter,
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'stdout', level: 'error' },
      { emit: 'stdout', level: 'info' },
      { emit: 'stdout', level: 'warn' },
    ],
  });

  // Only enable query logging in development and if the duration threshold is met
  if (process.env.NODE_ENV === 'development') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client as any).$on('query', (e: any) => {
      // Only log queries that exceed a performance threshold (e.g., 100ms)
      if (e.duration > 100) {
        console.log(chalk.yellowBright(`Slow Query (${e.duration}ms)`));
        try {
          console.log(chalk.gray(format(e.query, { language: 'postgresql' })));
        } catch {
          console.log(chalk.gray(e.query));
        }
        console.log(chalk.dim(`Params: ${e.params}`));
      }
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

// DEV-ONLY: `next dev --webpack` (Next 16) skips evaluating instrumentation.ts, so the
// submission worker that instrumentation normally starts never runs in the dev container.
// prisma is imported by every Node route/server component, so kicking the worker here
// starts it once the dev server handles its first DB-backed request. Guarded to
// development and the Node runtime; production starts the worker via instrumentation.ts
// as usual. The globalThis guard ensures a single start even though webpack evaluates
// this module in several bundle contexts (each with its own module-level state).
if (
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_RUNTIME !== 'edge' &&
  !globalForPrisma.devWorkerStarted
) {
  globalForPrisma.devWorkerStarted = true;
  void import('./submission-worker')
    .then((m) => m.startSubmissionWorker())
    .catch((err) => console.error('[dev] failed to start submission worker:', err));
}
