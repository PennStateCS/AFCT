import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Revokes one of the caller's own tokens.
 *
 * Scoped to the session in the `where`, not checked first and deleted after: a token id
 * belonging to someone else matches nothing rather than revoking their access. Marked revoked
 * rather than deleted, so a token that turns up in the log later can still be accounted for.
 * @openapi
 * summary: Revoke one of my client tokens
 * parameters:
 *   - { name: id, in: path, required: true, schema: { type: string } }
 * responses:
 *   200: { description: The token was revoked. }
 *   401: { description: Not signed in. }
 *   404: { description: No such token belonging to the caller. }
 */
export async function DELETE(req: Request, ctx: RouteCtx) {
  const session = await auth();
  // `inactive` as well as the id, matching the auth wrappers. A revoked session keeps its user
  // id on purpose so the rest of the app can tell who it was, and an id alone is not permission:
  // a disabled or deleted account, or one whose password was just reset, still presents one.
  if (!session?.user?.id || session.user.inactive) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { id } = await ctx.params;

  const { count } = await prisma.clientApiToken.updateMany({
    where: { id, userId: session.user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  if (count === 0) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 });
  }

  await createEnhancedActivityLog(prisma, req, {
    userId: session.user.id,
    action: 'CLIENT_TOKEN_REVOKED',
    severity: 'INFO',
    category: 'USER',
    metadata: { tokenId: id },
  });

  return NextResponse.json({ ok: true });
}
