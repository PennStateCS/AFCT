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
 * responses:
 *   201: { description: "The link, and when it expires." }
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
