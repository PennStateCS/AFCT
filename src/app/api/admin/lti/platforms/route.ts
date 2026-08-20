import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withAdminAuth } from '@/lib/api/with-auth';
import { readJson } from '@/lib/api/request';
import { apiError } from '@/lib/api/http';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { LtiPlatformSchema } from '@/schemas/lti';
import { ensureSigningKey } from '@/lib/lti/keys';

/**
 * The LMSs registered to launch into AFCT.
 *
 * Registration is deliberately an admin-only act: adding one grants that LMS the ability to
 * assert who somebody is, so it is closer to adding an identity provider than to editing a
 * setting.
 * @openapi
 * summary: List registered LMS platforms
 * responses:
 *   200:
 *     description: "Every registered platform, with the endpoints a launch and a grade use. There is nothing secret here: LTI 1.3 has no client secret, and AFCT's private key is never in a registration."
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             platforms:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id: { type: string }
 *                   name: { type: string }
 *                   issuer: { type: string }
 *                   clientId: { type: string }
 *                   deploymentId: { type: string }
 *                   authLoginUrl: { type: string }
 *                   tokenUrl: { type: string }
 *                   tokenAudience: { type: string, nullable: true }
 *                   keysetUrl: { type: string }
 *                   createdAt: { type: string }
 *   403: { description: Not an administrator. }
 */
export const GET = withAdminAuth(
  async () => {
    const platforms = await prisma.ltiPlatform.findMany({ orderBy: { createdAt: 'asc' } });
    return NextResponse.json({ platforms });
  },
  { deniedAction: 'LTI_PLATFORMS_VIEW_DENIED' },
);

/**
 * @openapi
 * summary: Register an LMS platform
 * description: >-
 *   The manual half of registration: every value comes from the LMS's own developer-key screen.
 *   A launch is matched on the issuer, client ID and deployment ID together, so the triple has
 *   to agree exactly with what the LMS sends. Registering also makes sure AFCT has a signing
 *   keypair, since the LMS fetches the keyset while being set up. Prefer the one-time
 *   registration link where the LMS supports automatic registration.
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [name, issuer, clientId, deploymentId, authLoginUrl, tokenUrl, keysetUrl]
 *         properties:
 *           name: { type: string, description: A label to recognise this LMS by. Nothing is matched on it. }
 *           issuer: { type: string, description: "The platform's issuer identifier. Usually a URL, not required to be." }
 *           clientId: { type: string, description: The client ID the LMS assigned to AFCT. }
 *           deploymentId: { type: string, description: The deployment ID the LMS assigned. }
 *           authLoginUrl: { type: string, description: "The platform's authorization endpoint (https)." }
 *           tokenUrl: { type: string, description: "The platform's token endpoint (https)." }
 *           tokenAudience: { type: string, nullable: true, description: "Where the client assertion is addressed when that differs from the token URL. Only D2L Brightspace needs it." }
 *           keysetUrl: { type: string, description: "The platform's public keyset URL (https)." }
 * responses:
 *   201: { description: Registered. Launches from this platform will now verify. }
 *   400: { description: A value was missing or malformed. The message names the field. }
 *   403: { description: Not an administrator. }
 *   409: { description: "That issuer, client ID and deployment ID are already registered." }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { session }) => {
    const body = await readJson(req, LtiPlatformSchema);
    if (!body.ok) return body.response;

    /**
     * Make sure AFCT has a keypair before the first LMS is registered.
     *
     * Keys are created on demand so an install that never touches LTI never carries one, but
     * "on demand" has to mean something. Registering is the moment: an LMS fetches the keyset
     * while being set up, and an empty one either fails there or, worse, much later when the
     * first grade fails to post.
     */
    await ensureSigningKey();

    let platform;
    try {
      platform = await prisma.ltiPlatform.create({ data: body.data });
    } catch (error) {
      // The unique constraint on the triple, rather than a check-then-create that two
      // administrators could both pass.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return apiError(
          409,
          'That LMS is already registered with this client ID and deployment ID.',
        );
      }
      throw error;
    }

    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'LTI_PLATFORM_REGISTERED',
      severity: 'WARNING',
      category: 'SYSTEM',
      metadata: {
        platformId: platform.id,
        issuer: platform.issuer,
        clientId: platform.clientId,
        deploymentId: platform.deploymentId,
      },
    });

    return NextResponse.json({ platform }, { status: 201 });
  },
  { deniedAction: 'LTI_PLATFORM_REGISTER_DENIED' },
);
