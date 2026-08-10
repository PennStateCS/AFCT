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
  if (!session?.user?.id) {
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
