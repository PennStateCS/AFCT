import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withAdminAuth } from '@/lib/api/with-auth';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { issueSingleUseToken } from '@/lib/single-use-token';
import { ensureSigningKey } from '@/lib/lti/keys';
import { publicUrl } from '@/lib/lti/public-url';
import { REGISTRATION_LINK_TTL_MS } from '@/lib/lti/dynamic-registration';

/**
 * A link an administrator pastes into their LMS to register AFCT automatically.
 *
 * The link is the whole of the authorisation for the registration that follows. It has to be,
 * because the LMS opens AFCT from another site and no AFCT cookie travels with that request, so
 * there is no session on the other end to check. Hence: minted only by an administrator, spent
 * exactly once, valid for an hour, and stored as a hash like every other single-use token.
 *
 * @openapi
 * summary: Create a one-time link for registering an LMS automatically
 * description: >-
 *   The link is pasted into the LMS's own registration screen and is the whole authorisation
 *   for what follows, since the LMS calls back without any AFCT session. It works exactly once,
 *   expires after an hour, and is spent even by a failed attempt, so a link can never register
 *   two platforms. Minting one is logged as a security-relevant event.
 * responses:
 *   201:
 *     description: "The link, and when it expires. Shown once; a new one costs a click."
 *     content:
 *       application/json:
 *         schema:
 *           type: object
 *           properties:
 *             url: { type: string }
 *             expiresAt: { type: string }
 *   403: { description: Not an administrator. }
 */
export const POST = withAdminAuth(
  async (req, _ctx, { session }) => {
    // Same reason as registering by hand: the LMS fetches the keyset while it registers, and an
    // empty one fails there, or later and less obviously when the first grade is sent.
    await ensureSigningKey();

    const { token, expiresAt } = await issueSingleUseToken({
      purpose: 'LTI_DYNAMIC_REGISTRATION',
      userId: session.user.id,
      ttlMs: REGISTRATION_LINK_TTL_MS,
    });

    const url = publicUrl(`/lti/register?rt=${encodeURIComponent(token)}`, req);

    // WARNING rather than INFO: holding this link is the ability to add an LMS that can then
    // assert who anybody is, so it belongs next to the registration it leads to.
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'LTI_REGISTRATION_LINK_CREATED',
      severity: 'WARNING',
      category: 'SYSTEM',
      metadata: { expiresAt: expiresAt.toISOString() },
    });

    return NextResponse.json({ url, expiresAt: expiresAt.toISOString() }, { status: 201 });
  },
  { deniedAction: 'LTI_REGISTRATION_LINK_DENIED' },
);
