// lib/prisma.ts

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { format } from 'sql-formatter';
import chalk from 'chalk';

// Use a global singleton in development to avoid creating multiple Prisma instances on reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
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
