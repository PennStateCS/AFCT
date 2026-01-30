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
