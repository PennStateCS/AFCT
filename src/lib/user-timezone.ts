import { prisma } from '@/lib/prisma';

/** Default timezone used when neither the user nor the system defines one. */
export const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Resolves the timezone to interpret a user's datetime-local input in, preferring the
 * user's own setting, then the system default, then {@link DEFAULT_TIMEZONE}. Route
 * handlers that convert `datetime-local` strings to UTC all need this, so it lives in
 * one place instead of being re-inlined per route.
 */
export async function resolveUserTimezone(userId?: string | null): Promise<string> {
  if (!userId) return DEFAULT_TIMEZONE;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  if (user?.timezone) return user.timezone;

  const system = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return system?.timezone || DEFAULT_TIMEZONE;
}
