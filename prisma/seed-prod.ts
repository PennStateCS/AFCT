/**
 * Production seed routine.
 *
 * Keeps production seeding minimal and safe by bootstrapping a single admin
 * account only when the database is empty.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { getProductionAdminCredentials, maybeBootstrapAdmin } from './seed-utils';

/**
 * Seed production data.
 *
 * This does not populate sample content. It only creates the initial admin if
 * no users exist yet.
 */
export const runProductionSeed = async (prisma: PrismaClient) => {
  // Resolve admin credentials from environment or prompts.
  const { adminEmail, adminFirstName, adminLastName, adminPassword } =
    await getProductionAdminCredentials();

  // Store hashed password only.
  const prodHashed = await bcrypt.hash(adminPassword, 10);

  try {
    // Bootstrap the admin if the database is empty.
    await maybeBootstrapAdmin(prisma, adminEmail, adminFirstName, adminLastName, prodHashed);

    // Seed system settings if the database is empty
    const userCount = await prisma.user.count();
    if (userCount === 1) {
      // Database was just initialized with the admin user
      console.log('[seed] production: seeding system settings');
      try {
        await prisma.systemSettings.upsert({
          where: { id: 1 },
          update: {
            maxUploadSizeMb: 25,
            timezone: 'America/New_York',
          },
          create: {
            id: 1,
            maxUploadSizeMb: 25,
            timezone: 'America/New_York',
          },
        });
        console.log('[seed] production: system settings configured (25MB, America/New_York)');
      } catch (error) {
        console.error('[seed] production: error seeding system settings', error);
        throw error;
      }
    }

    return;
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2021'
    ) {
      console.log('[seed] production: missing tables; run migrations first');
      return;
    }
    throw error;
  }
};
