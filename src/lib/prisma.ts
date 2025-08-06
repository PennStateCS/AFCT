// lib/prisma.ts

import { PrismaClient } from '@prisma/client';
import { format } from 'sql-formatter';
import chalk from 'chalk';

// Use a global singleton in development to avoid creating multiple Prisma instances on reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Initialize Prisma with query event logging
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [{ emit: 'event', level: 'query' }],
  });

// Cache the Prisma client globally in development
if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Log SQL query strings with timing and formatting
prisma.$on('query', (e) => {
  // Only log queries that exceed a performance threshold (e.g., 100ms)
  if (e.duration > 100) {
    console.log(chalk.yellowBright(`Slow Query (${e.duration}ms)`));
    console.log(chalk.gray(format(e.query)));
    console.log(chalk.dim(`Params: ${e.params}`));
  }
});

// Optional middleware that times each Prisma operation by model and action
prisma.$use(async (params, next) => {
  const start = Date.now();
  const result = await next(params);
  const duration = Date.now() - start;

  // Log the model and action if the operation was slow
  if (duration > 100) {
    console.log(chalk.magenta(`${params.model}.${params.action} took ${duration}ms`));
  }

  return result;
});
