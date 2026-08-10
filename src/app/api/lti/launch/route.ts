import { NextResponse } from 'next/server';
import { validateLaunch, launchRefusalMessage } from '@/lib/lti/launch';
import { resolveLaunchSignIn, launchSignInRefusalMessage } from '@/lib/lti/lti-signin';
import { LTI_STATE_COOKIE } from '@/lib/lti/login-init';
import { consumeSingleUseToken, issueSingleUseToken } from '@/lib/single-use-token';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { prisma } from '@/lib/prisma';

/**
 * Where the LMS posts the signed launch token.
 *
 * Public, because nobody is signed in yet: that is what a launch is for. Everything arriving
 * here is verified before it is used.
 *
 * The session is not created here. It is minted by NextAuth, so this hands the browser a
 * single-use ticket and a small page spends it. That keeps one path for creating a session
 * instead of two.
 */

/** Long enough to redirect and sign in, short enough to be useless if it leaks. */
const TICKET_TTL_MS = 60 * 1000;

function refuse(message: string, status: number) {
  // Plain text: a person is reading this inside an LMS frame, not code.
  return new NextResponse(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/**
 * @openapi
 * summary: Receive a signed LTI launch from an LMS
 * security: []
 * responses:
 *   302: { description: Verified. Redirects to complete sign-in. }
 *   400: { description: "The launch was missing its state, or the state did not match." }
 *   403: { description: The launch could not be verified. }
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const idToken = form.get('id_token');
  const state = form.get('state');

  if (typeof idToken !== 'string' || typeof state !== 'string') {
    return refuse('This launch was incomplete. Go back to your LMS and try again.', 400);
  }

  /**
   * The state check, in two halves that catch different things.
   *
   * The cookie proves the launch is finishing in the same browser that started it. Without it,
   * somebody can start a launch as themselves and get a victim's browser to complete it, signing
   * the victim in as the attacker; the nonce cannot catch that, because such a launch is fresh
   * rather than replayed.
   *
   * Consuming the stored token proves AFCT issued this state and that it has not been used.
   */
  const cookieState = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LTI_STATE_COOKIE}=`))
    ?.slice(LTI_STATE_COOKIE.length + 1);

  if (!cookieState || cookieState !== state) {
    return refuse(
      'This launch could not be matched to your browser. If your browser blocks third-party cookies, open AFCT in a new tab and try again.',
      400,
    );
  }

  const spent = await consumeSingleUseToken({ token: state, purpose: 'LTI_LAUNCH_STATE' });
  if (!spent) {
    return refuse(
      'This launch has already been used. Go back to your LMS and click the link again.',
      400,
    );
  }

  const verified = await validateLaunch({ idToken });
  if (!verified.ok) {
    await createEnhancedActivityLog(prisma, request, {
      userId: null,
      action: 'LTI_LAUNCH_DENIED',
      severity: 'SECURITY',
      category: 'USER',
      metadata: { reason: verified.reason },
    });
    return refuse(launchRefusalMessage(verified.reason), 403);
  }

  const signIn = await resolveLaunchSignIn({ identity: verified.identity, context: request });
  if (!signIn.ok) {
    await createEnhancedActivityLog(prisma, request, {
      userId: null,
      action: 'LTI_LAUNCH_DENIED',
      severity: 'SECURITY',
      category: 'USER',
      metadata: { reason: signIn.reason, issuer: verified.identity.issuer },
    });
    return refuse(launchSignInRefusalMessage(signIn.reason), 403);
  }

  const { token: ticket } = await issueSingleUseToken({
    purpose: 'LTI_SESSION_TICKET',
    userId: signIn.userId,
    ttlMs: TICKET_TTL_MS,
  });

  const next = new URL('/lti/complete', request.url);
  next.searchParams.set('ticket', ticket);

  const response = NextResponse.redirect(next, 303);
  // Spent, so it cannot be replayed even though the token behind it is already consumed.
  response.cookies.delete(LTI_STATE_COOKIE);
  return response;
}
