import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { listIdentitiesForUser } from '@/lib/linked-identity';

/**
 * The institutional sign-ins attached to the caller's own account.
 *
 * Also reports whether they have a local password, because that is what decides if the last
 * identity can be removed. The page needs both to say anything useful, and one request that
 * answers the question beats two that each answer half of it.
 * @openapi
 * summary: List the institutional sign-ins connected to my account
 * responses:
 *   200: { description: "The caller's linked identities, and whether they have a password." }
 *   401: { description: Not signed in. }
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const [identities, user] = await Promise.all([
    listIdentitiesForUser(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    }),
  ]);

  return NextResponse.json({
    identities,
    // Whether one exists, never anything about it.
    hasPassword: Boolean(user?.password),
  });
}
