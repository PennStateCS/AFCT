import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { listIdentitiesForUser } from '@/lib/linked-identity';
import {
  canSetInitialPassword,
  linkedAccountPasswordsAllowed,
} from '@/lib/account-credentials';

/**
 * The institutional sign-ins attached to the caller's own account.
 *
 * Also reports whether they have a local password, because that is what decides if the last
 * identity can be removed. The page needs both to say anything useful, and one request that
 * answers the question beats two that each answer half of it.
 * @openapi
 * summary: List the institutional sign-ins connected to my account
 * responses:
 *   200:
 *     description: "The caller's linked identities, whether they have a password, and whether they may set one."
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             identities: { type: array, items: { type: object } }
 *             hasPassword: { type: boolean }
 *             canSetPassword: { type: boolean, description: "True only when there is no password and the site allows one on an account that signs in elsewhere." }
 *   401: { description: Not signed in. }
 */
export async function GET() {
  const session = await auth();
  // `inactive` as well as the id, matching the auth wrappers. A revoked session keeps its user
  // id on purpose so the rest of the app can tell who it was, and an id alone is not permission:
  // a disabled or deleted account, or one whose password was just reset, still presents one.
  if (!session?.user?.id || session.user.inactive) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const [identities, user, allowed] = await Promise.all([
    listIdentitiesForUser(session.user.id),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true },
    }),
    linkedAccountPasswordsAllowed(),
  ]);

  const hasPassword = Boolean(user?.password);

  return NextResponse.json({
    identities,
    // Whether one exists, never anything about it.
    hasPassword,
    /**
     * Whether the account page should offer to set a first password.
     *
     * Computed here rather than on the page, so the policy lives in one place and the browser
     * is never in the position of offering something the endpoint will refuse.
     */
    canSetPassword: canSetInitialPassword({ hasPassword, allowed }),
  });
}
