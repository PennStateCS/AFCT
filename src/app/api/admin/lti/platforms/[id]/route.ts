import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAdminAuth } from '@/lib/api/with-auth';
import { apiError } from '@/lib/api/http';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { clearAccessTokenCache } from '@/lib/lti/access-token';

/**
 * Remove a registration, which stops that LMS launching into AFCT.
 *
 * A hard delete rather than a soft one, unlike most of AFCT. There is nothing here worth
 * keeping: the row is configuration an administrator typed, it holds no student record, and a
 * registration that still exists is one that still works. Who removed it is in the activity log,
 * which is where that question belongs.
 * @openapi
 * summary: Remove a registered LMS platform
 * responses:
 *   200: { description: "Removed, with its course links and remembered gradebook columns. Launches from that LMS are refused from now on; grades already in the LMS stay there. The LMS's own developer key is untouched, so re-registering the same values restores service." }
 *   403: { description: Not an administrator. }
 *   404: { description: No such registration. }
 */
export const DELETE = withAdminAuth<{ params: Promise<{ id: string }> }>(
  async (req, ctx, { session }) => {
    const { id } = await ctx.params;

    const platform = await prisma.ltiPlatform.findUnique({ where: { id } });
    if (!platform) return apiError(404, 'Not found');

    await prisma.ltiPlatform.delete({ where: { id } });
    // Any token minted for this registration is now for something that no longer exists.
    clearAccessTokenCache(id);

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'LTI_PLATFORM_REMOVED',
      severity: 'WARNING',
      category: 'SYSTEM',
      metadata: {
        platformId: id,
        issuer: platform.issuer,
        clientId: platform.clientId,
        deploymentId: platform.deploymentId,
      },
    });

    return NextResponse.json({ success: true });
  },
  { deniedAction: 'LTI_PLATFORM_REMOVE_DENIED' },
);
