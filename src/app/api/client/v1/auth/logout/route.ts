import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withClientAuth } from '@/lib/api/with-client-auth';
import { revokeClientToken } from '@/lib/client-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

/**
 * Revokes the bearer token used to make this request, so it can no longer
 * authenticate. Idempotent.
 * @openapi
 * summary: Client logout (revoke the current token)
 * responses:
 *   200: { description: Token revoked. }
 *   401: { description: Missing or invalid token. }
 */
export const POST = withClientAuth(async (req, _ctx, { user, tokenId }) => {
  await revokeClientToken(tokenId);
  await createEnhancedActivityLog(prisma, req, {
    userId: user.id,
    action: 'CLIENT_LOGOUT',
    severity: 'INFO',
    category: 'USER',
    metadata: { userId: user.id },
  });
  return NextResponse.json({ success: true });
});
