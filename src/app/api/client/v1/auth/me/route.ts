import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withClientAuth } from '@/lib/api/with-client-auth';

/**
 * Whoami / token check. A cheap endpoint the client can call to confirm its bearer
 * token is still valid: `200` with the user when the token is good, `401` when it's
 * missing, expired, or revoked. (Also renews the sliding expiry, like any
 * authenticated call.)
 * @openapi
 * summary: Check the current token (whoami)
 * responses:
 *   200:
 *     description: The token is valid; returns the signed-in user.
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             user: { type: object }
 *             expiresAt: { type: string, nullable: true, description: When the (sliding) token expires }
 *   401: { description: "Missing, expired, or revoked token." }
 */
export const GET = withClientAuth(async (_req, _ctx, { user, tokenId }) => {
  const token = await prisma.clientApiToken.findUnique({
    where: { id: tokenId },
    select: { expiresAt: true },
  });
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    },
    expiresAt: token?.expiresAt ? token.expiresAt.toISOString() : null,
  });
});
