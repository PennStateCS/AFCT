/**
 * Prisma seed entrypoint.
 *
 * This file routes to environment-specific seed routines:
 * - Production: bootstrap a minimal admin user if the database is empty.
 * - Development: create sample users, courses, and rosters for local use.
 *
 * Note: This file should remain small and focused on orchestration. Detailed
 * logic lives in `seed-dev.ts` and `seed-prod.ts`.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { runDevelopmentSeed } from './seed-dev';
import { runProductionSeed } from './seed-prod';

// Prisma 7 no longer reads the datasource url from the schema, so a standalone
// script must supply a driver adapter (mirrors src/lib/prisma.ts). DATABASE_URL
// is injected from the env file by prisma.config.ts / the seed command.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * Main seed runner.
 *
 * Uses `NODE_ENV` to decide which seed path to run. Production is intentionally
 * conservative to avoid overwriting live data.
 */
async function main() {
  console.log('[seed] starting');

  // Treat only explicit production as production.
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    // Production: minimal bootstrap only.
    await runProductionSeed(prisma);
    return;
  }

  // Development: full sample dataset for local use.
  await runDevelopmentSeed(prisma);
}

// Ensure errors are surfaced and the Prisma client is closed.
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
