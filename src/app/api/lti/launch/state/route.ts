import { NextResponse } from 'next/server';
import { completeLaunch } from '@/app/api/lti/launch/route';
import { findLaunch } from '@/lib/lti/launch-transaction';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Finishing a launch whose state came from the platform's browser storage rather than a cookie.
 *
 * Reached only from `/lti/state-check`, which is reached only when the launch arrived without its
 * cookie and the platform had offered storage. The page reads what the platform kept and posts it
 * here; if it is the state this launch was issued, the token waiting on the launch row is
 * verified exactly as the ordinary path verifies it.
 *
 * **What this proves, and what it does not.** A cookie is strong because the browser sends it
 * unprompted and no other site can read it or plant it. This is weaker: the value arrives from a
 * page, so it says a page on AFCT's origin in this browser was given this value by the platform,
 * not that this browser began this launch. It is used only where the cookie did not arrive, so
 * the alternative is not a stronger check but no launch at all, and never in place of a cookie
 * that did arrive. The launch is still single-use, still expires in minutes, and its token still
 * has to verify against the registration, which is what bounds the exposure.
 *
 * @openapi
 * summary: Finish a launch using the state the platform stored in the browser
 * security: []
 * requestBody:
 *   required: true
 *   content:
 *     application/x-www-form-urlencoded:
 *       schema:
 *         type: object
 *         required: [state, stored]
 *         properties:
 *           state: { type: string }
 *           stored: { type: string, description: "What the platform had kept for this launch" }
 * responses:
 *   303: { description: Verified; on to the signed-in destination. }
 *   400: { description: "The stored value did not match, or there was nothing waiting." }
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const state = form.get('state');
  const stored = form.get('stored');

  const refuse = (message: string) =>
    new NextResponse(message, {
      status: 400,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

  if (typeof state !== 'string' || typeof stored !== 'string') {
    return refuse('This launch was incomplete. Go back to your LMS and try again.');
  }

  const launch = await findLaunch(state);
  // A launch with nothing parked was never sent here, so this is not a route to complete an
  // arbitrary state: something has to have arrived without a cookie first.
  if (!launch.ok || !launch.launch.idToken || !launch.launch.storageTarget) {
    return refuse('This launch has already been used or has expired. Open AFCT again.');
  }

  if (stored !== state) {
    await createEnhancedActivityLog(prisma, request, {
      userId: null,
      // Worth a security entry: either a browser lost the value between the two hops, or
      // somebody tried to finish a launch they did not start.
      action: 'LTI_LAUNCH_DENIED',
      severity: 'SECURITY',
      category: 'USER',
      metadata: { reason: 'stored-state-mismatch' },
    });
    return refuse('This launch could not be matched to your browser. Open AFCT again.');
  }

  return completeLaunch(request, launch.launch.idToken, state);
}
