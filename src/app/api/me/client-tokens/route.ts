import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { readJson } from '@/lib/api/request';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { issueClientToken, CLIENT_TOKEN_TTL_MS } from '@/lib/client-auth';
import { IssueClientTokenSchema } from '@/schemas/client';

/**
 * The signed-in user's own tokens for the desktop client.
 *
 * Scoped to the caller throughout: there is no user id in the path, and every query is keyed on
 * the session. A token is a way into someone's account, so listing or revoking another person's
 * is not something this route can be asked to do by mistake.
 * @openapi
 * summary: List my client tokens
 * responses:
 *   200: { description: "The caller's tokens. The token values themselves are never returned." }
 *   401: { description: Not signed in. }
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const tokens = await prisma.clientApiToken.findMany({
    where: { userId: session.user.id, revokedAt: null },
    // No tokenHash: it is not a secret worth handing back, and nothing on screen needs it.
    select: { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ tokens });
}

/**
 * Issues a token for the desktop client.
 *
 * The plaintext is returned exactly once, here, and never stored. That is the whole reason this
 * endpoint exists: without it, the only way to get a token is the client's email-and-password
 * login, which an account with no local password cannot use.
 * @openapi
 * summary: Issue a client token
 * requestBody:
 *   required: true
 *   content:
 *     application/json:
 *       schema:
 *         type: object
 *         properties:
 *           label: { type: string, description: A name to recognise this token by }
 * responses:
 *   201: { description: "The new token. This is the only time its value is returned." }
 *   400: { description: Bad body. }
 *   401: { description: Not signed in. }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const parsed = await readJson(req, IssueClientTokenSchema);
  if (!parsed.ok) return parsed.response;

  const issued = await issueClientToken(session.user.id, {
    label: parsed.data.label ?? null,
    ttlMs: CLIENT_TOKEN_TTL_MS,
  });

  await createEnhancedActivityLog(prisma, req, {
    userId: session.user.id,
    action: 'CLIENT_TOKEN_ISSUED',
    severity: 'INFO',
    category: 'USER',
    // The token itself is never logged; the id is enough to tie this to a later revocation.
    metadata: { tokenId: issued.tokenId, label: parsed.data.label ?? null },
  });

  return NextResponse.json(
    { token: issued.token, id: issued.tokenId, expiresAt: issued.expiresAt },
    { status: 201 },
  );
}
