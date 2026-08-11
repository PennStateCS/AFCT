import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAdminAuth } from '@/lib/api/with-auth';
import { apiError } from '@/lib/api/http';
import { listIdentitiesForUser, unlinkIdentity } from '@/lib/linked-identity';

/**
 * How somebody signs in, for an administrator looking at their account.
 *
 * The question this answers is "why can this person not get in", which today can only be
 * answered by reading the database. Shows what is attached and how it came to be, never
 * anything secret: an issuer and a subject identify a person to a provider, they do not
 * authenticate anyone.
 * @openapi
 * summary: The sign-in methods attached to a user's account
 * responses:
 *   200: { description: "Their linked identities, and whether they have a password." }
 *   403: { description: Not an administrator. }
 *   404: { description: No such user. }
 */
export const GET = withAdminAuth<{ params: Promise<{ id: string }> }>(
  async (_req, ctx) => {
    const { id } = await ctx.params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { password: true },
    });
    if (!user) return apiError(404, 'Not found');

    return NextResponse.json({
      identities: await listIdentitiesForUser(id),
      // Whether one exists, never anything about it.
      hasPassword: Boolean(user.password),
    });
  },
  { deniedAction: 'USER_IDENTITIES_VIEW_DENIED', deniedCategory: 'USER' },
);

/**
 * Detach one of somebody's sign-in methods.
 *
 * Refuses to remove their last way in, exactly as the self-service page does: an account with
 * no password and no identity can only be recovered by changing the database, and an
 * administrator helping with a sign-in problem should not be able to create a worse one.
 * @openapi
 * summary: Detach a sign-in method from a user's account
 * responses:
 *   200: { description: Detached. }
 *   403: { description: Not an administrator. }
 *   404: { description: No such identity on that account. }
 *   409: { description: "That is the only way to sign in to the account." }
 */
export const DELETE = withAdminAuth<{ params: Promise<{ id: string }> }>(
  async (req, ctx, { session }) => {
    const { id } = await ctx.params;
    const identityId = new URL(req.url).searchParams.get('identityId');
    if (!identityId) return apiError(400, 'Which sign-in method?');

    const [user, count] = await Promise.all([
      prisma.user.findUnique({ where: { id }, select: { password: true } }),
      prisma.linkedIdentity.count({ where: { userId: id } }),
    ]);
    if (!user) return apiError(404, 'Not found');

    if (!user.password && count <= 1) {
      return apiError(
        409,
        'That is the only way this person can sign in. Give them a password first, then it can be removed.',
      );
    }

    const removed = await unlinkIdentity({
      id: identityId,
      userId: id,
      // The administrator did this, not the account holder. Recording the account holder here
      // would make an admin action look like the person's own.
      actorUserId: session.user.id,
      context: req,
    });
    if (!removed) return apiError(404, 'Not found');

    return NextResponse.json({ success: true });
  },
  { deniedAction: 'USER_IDENTITY_UNLINK_DENIED', deniedCategory: 'USER' },
);
