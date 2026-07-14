/**
 * Production seed routine.
 *
 * Keeps production seeding minimal and safe by bootstrapping a single admin
 * account only when the database is empty.
 */
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { getProductionAdminCredentials, maybeBootstrapAdmin } from './seed-utils';

/**
 * Seed production data.
 *
 * This does not populate sample content. It only creates the initial admin if
 * no users exist yet.
 */
export const runProductionSeed = async (prisma: PrismaClient) => {
  try {
    // Only bootstrap on an empty database. Resolving (and requiring) admin
    // credentials only when there are no users means a healthy deployment's
    // restarts never need ADMIN_EMAIL/ADMIN_PASSWORD present, while a first-time
    // bootstrap still fails loudly rather than seeding a default login.
    const existingUsers = await prisma.user.count();
    if (existingUsers > 0) {
      console.log('[seed] production: users already exist, skipping admin bootstrap');
      return;
    }

    const { adminEmail, adminFirstName, adminLastName, adminPassword } =
      await getProductionAdminCredentials();

    // Store hashed password only.
    const prodHashed = await bcrypt.hash(adminPassword, 10);

    await maybeBootstrapAdmin(prisma, adminEmail, adminFirstName, adminLastName, prodHashed);

    console.log('[seed] production: seeding system settings');
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
