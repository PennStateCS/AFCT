import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { readJson } from '@/lib/api/request';
import { apiError } from '@/lib/api/http';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { consumeSingleUseToken } from '@/lib/single-use-token';
import { publicUrl } from '@/lib/lti/public-url';
import { fetchPlatformConfiguration, requestRegistration } from '@/lib/lti/dynamic-registration';

const BodySchema = z.object({
  /** The one-time token out of the link an administrator pasted into their LMS. */
  token: z.string().trim().min(1),
  /** Where the LMS says its own settings can be read. Passed through from the launch URL. */
  openidConfiguration: z.string().trim().min(1),
  /** The LMS's own short-lived credential for its registration endpoint, when it sent one. */
  registrationToken: z.string().trim().min(1).nullish(),
});

/**
 * Register AFCT with an LMS, on the LMS's own instruction.
 *
 * Unauthenticated by necessity: the request comes from a page the LMS framed, and no AFCT
 * cookie survives that. The one-time token stands in for the session, and **it is spent before
 * anything else happens**. That ordering is the security of this route, not a detail: until the
 * token is proven good, AFCT makes no outbound request at all, so a stranger who guesses this
 * URL cannot use it to make the server fetch an address of their choosing.
 *
 * Spending first also means a failed registration burns the link. That is deliberate. The
 * alternative, spending it on success, would let one link register two different platforms,
 * and a registration grants an LMS the ability to assert who somebody is. Minting another link
 * costs an administrator one click.
 *
 * @openapi
 * summary: Complete an automatic LMS registration
 * description: >-
 *   The server half of LTI Dynamic Registration, called by the page the LMS frames. The
 *   one-time token from the registration link stands in for a session and is spent before any
 *   outbound request is made; AFCT then reads the platform's OpenID configuration, posts its
 *   own description to the platform's registration endpoint, and saves the registration the
 *   platform answers with. A failed attempt burns the link, so one link can never register two
 *   platforms.
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         required: [token, openidConfiguration]
 *         properties:
 *           token: { type: string, description: The one-time token out of the registration link an administrator minted. }
 *           openidConfiguration: { type: string, description: "Where the LMS says its own settings can be read; must be https." }
 *           registrationToken: { type: string, nullable: true, description: "The LMS's short-lived credential for its registration endpoint, when it sent one." }
 * responses:
 *   201:
 *     description: "Registered. Returns what was saved, plus notes worth reading (for example, that the LMS granted no service permissions)."
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             platform:
 *               type: object
 *               properties:
 *                 name: { type: string }
 *                 issuer: { type: string }
 *                 clientId: { type: string }
 *                 deploymentId: { type: string }
 *             notes: { type: array, items: { type: string } }
 *   400: { description: "The link was expired or already used, or the LMS's settings could not be read, or its answer was missing what a registration needs. The message says which." }
 *   409: { description: That LMS is already registered. }
 */
export async function POST(req: Request) {
  const body = await readJson(req, BodySchema);
  if (!body.ok) return body.response;

  const consumed = await consumeSingleUseToken({
    token: body.data.token,
    purpose: 'LTI_DYNAMIC_REGISTRATION',
  });
  if (!consumed) {
    return apiError(
      400,
      'This registration link has expired or has already been used. Create a new one in AFCT under System Settings, LTI, and start again.',
    );
  }

  // Who is answerable for the registration: the administrator who minted the link, not the LMS
  // that redeemed it. Null only if that account has since been deleted.
  const actorId = consumed.userId;

  const failed = async (reason: string, message: string, status: 400 | 409) => {
    await createEnhancedActivityLog(prisma, req, {
      userId: actorId,
      action: 'LTI_DYNAMIC_REGISTRATION_FAILED',
      severity: 'ERROR',
      category: 'SYSTEM',
      metadata: { reason, openidConfiguration: body.data.openidConfiguration },
    });
    return apiError(status, message);
  };

  const configuration = await fetchPlatformConfiguration(body.data.openidConfiguration);
  if (!configuration.ok) {
    return failed(configuration.reason, configuration.message, 400);
  }

  const result = await requestRegistration({
    config: configuration.config,
    registrationToken: body.data.registrationToken ?? null,
    baseUrl: publicUrl('/', req),
  });
  if (!result.ok) {
    return failed(result.reason, result.message, 400);
  }

  let platform;
  try {
    platform = await prisma.ltiPlatform.create({ data: result.platform });
  } catch (error) {
    // The same unique triple the manual form is held to. Two administrators registering the
    // same LMS at once land here rather than creating a duplicate.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return failed(
        'already-registered',
        'This LMS is already registered with AFCT, so nothing was changed. Remove the existing registration first if you want to replace it.',
        409,
      );
    }
    throw error;
  }

  await createEnhancedActivityLog(prisma, req, {
    userId: actorId,
    action: 'LTI_PLATFORM_REGISTERED',
    severity: 'WARNING',
    category: 'SYSTEM',
    metadata: {
      platformId: platform.id,
      issuer: platform.issuer,
      clientId: platform.clientId,
      deploymentId: platform.deploymentId,
      // What separates this from a row somebody typed in, which matters when a registration
      // has to be explained months later.
      via: 'dynamic-registration',
    },
  });

  return NextResponse.json(
    {
      platform: {
        name: platform.name,
        issuer: platform.issuer,
        clientId: platform.clientId,
        deploymentId: platform.deploymentId,
      },
      notes: result.notes,
    },
    { status: 201 },
  );
}
