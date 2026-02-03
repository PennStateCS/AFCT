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
export const runProductionSeed = async (prisma: PrismaClient): Promise<void> => {
  try {
    // Resolve admin credentials from environment or prompts.
    const { adminEmail, adminFirstName, adminLastName, adminPassword } =
      await getProductionAdminCredentials();

    if (!adminPassword) {
      throw new Error(
        '[seed] production: admin password is empty; set ADMIN_PASSWORD or DEFAULT_ADMIN_PASSWORD',
      );
    }

    // Store hashed password only.
    let prodHashed: string;
    try {
      prodHashed = await bcrypt.hash(adminPassword, 10);
    } catch (error: unknown) {
      console.error('[seed] production: failed to hash admin password', error);
      throw error;
    }

    // Bootstrap the admin if the database is empty.
    try {
      await maybeBootstrapAdmin(prisma, adminEmail, adminFirstName, adminLastName, prodHashed);
    } catch (dbError: unknown) {
      if (
        typeof dbError === 'object' &&
        dbError !== null &&
        'code' in dbError &&
        (dbError as { code?: string }).code === 'P2021'
      ) {
        console.log('[seed] production: missing tables; run migrations first');
        return;
      }
      throw dbError;
    }
  } catch (error: unknown) {
    console.error('[seed] production: seed failed', error);
    throw error;
  }
};
