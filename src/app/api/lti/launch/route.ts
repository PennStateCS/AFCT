import { NextResponse } from 'next/server';
import { validateLaunch, launchRefusalMessage } from '@/lib/lti/launch';
import type { LaunchIdentity } from '@/lib/lti/launch';
import { resolveLaunchSignIn, launchSignInRefusalMessage } from '@/lib/lti/lti-signin';
import { stateCookieName } from '@/lib/lti/login-init';
import { issueSingleUseToken } from '@/lib/single-use-token';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { resolveLaunchTarget, enrolFromLaunch } from '@/lib/lti/course-link';
import { prisma } from '@/lib/prisma';
import { publicUrl } from '@/lib/lti/public-url';

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

/** Long enough for somebody to read the picker and choose. */
const PENDING_LINK_TTL_MS = 30 * 60 * 1000;

/**
 * How long an administrator has to type their password before the launch has to be repeated.
 *
 * Short, because it stands for a verified launch that has not been signed in yet, and long
 * enough to fetch a password manager.
 */
const ADMIN_CONFIRM_TTL_MS = 10 * 60 * 1000;

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
  const cookieName = stateCookieName(state);
  const cookieState = request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);

  if (!cookieState || cookieState !== state) {
    return refuse(
      'This launch could not be matched to your browser. If your browser blocks third-party cookies, open AFCT in a new tab and try again.',
      400,
    );
  }

  // The launch itself is spent inside validateLaunch, once the token has proved out, so a
  // launch that fails for another reason can be retried rather than burned.
  const verified = await validateLaunch({ idToken, state });
  if (!verified.ok) {
    await createEnhancedActivityLog(prisma, request, {
      userId: null,
      action: 'LTI_LAUNCH_DENIED',
      severity: 'SECURITY',
      category: 'USER',
      // `observed` is only present on an unregistered platform, and is what the token claimed
      // rather than anything proved. Named accordingly in the log.
      metadata: { reason: verified.reason, observedClaims: verified.observed ?? null },
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

    /**
     * An administrator is the one refusal with a way through.
     *
     * The rule stands: an email an LMS asserts must never attach a sign-in to an account that
     * can read every student record in the system. But refusing outright told them to connect
     * from a page that cannot connect an LMS, which is not an instruction, it is a wall. So the
     * launch pauses instead, and asks for the AFCT password. That is the one thing an LMS
     * cannot assert, so supplying it makes the link deliberate rather than automatic.
     */
    if (signIn.reason === 'admin-requires-deliberate-link' && signIn.userId) {
      const pending = await prisma.ltiPendingIdentityLink.create({
        data: {
          issuer: verified.identity.issuer,
          subject: verified.identity.subject,
          userId: signIn.userId,
          expiresAt: new Date(Date.now() + ADMIN_CONFIRM_TTL_MS),
        },
        select: { id: true },
      });

      const confirm = new URL(publicUrl('/lti/confirm', request));
      confirm.searchParams.set('pending', pending.id);
      const response = NextResponse.redirect(confirm, 303);
      response.cookies.delete(cookieName);
      return response;
    }

    return refuse(launchSignInRefusalMessage(signIn.reason), 403);
  }

  // Where this person ends up, decided here because this is the last point that holds the
  // verified launch. Everything after it is a browser following a link.
  const destination = await decideDestination(verified.identity, signIn.userId);

  const { token: ticket } = await issueSingleUseToken({
    purpose: 'LTI_SESSION_TICKET',
    userId: signIn.userId,
    ttlMs: TICKET_TTL_MS,
  });

  // Same reason as the redirect_uri: the request's host is internal behind a proxy, and a
  // browser sent there lands nowhere.
  const next = new URL(publicUrl('/lti/complete', request));
  next.searchParams.set('ticket', ticket);
  next.searchParams.set('next', destination);

  const response = NextResponse.redirect(next, 303);
  // Spent, so it cannot be replayed even though the token behind it is already consumed.
  response.cookies.delete(cookieName);
  return response;
}

/**
 * Where a verified launch should land.
 *
 * A launch from a linked LMS course goes to that course, enrolling the person on the way. One
 * from an unlinked course goes to the picker if they may link it, and to an explanation if they
 * may not, which for a student means their instructor has not finished setting it up.
 */
async function decideDestination(identity: LaunchIdentity, userId: string): Promise<string> {
  /**
   * A deep-linking launch is not somebody opening a course, it is staff being asked to choose.
   * The return URL is stored rather than carried in the browser: in a URL it could be changed,
   * and AFCT signs what it sends there with its own key.
   */
  if (identity.deepLink) {
    const pending = await prisma.ltiPendingDeepLink.create({
      data: {
        platformId: identity.platformId,
        contextId: identity.contextId,
        returnUrl: identity.deepLink.returnUrl,
        data: identity.deepLink.data,
        acceptTypes: identity.deepLink.acceptTypes,
        acceptPresentationDocumentTargets: identity.deepLink.acceptPresentationDocumentTargets,
        acceptLineItem: identity.deepLink.acceptLineItem,
        acceptMultiple: identity.deepLink.acceptMultiple,
        userId,
        expiresAt: new Date(Date.now() + PENDING_LINK_TTL_MS),
      },
      select: { id: true },
    });
    return `/lti/deep-link?pending=${pending.id}`;
  }

  const target = await resolveLaunchTarget({ identity, userId });

  if (target.status === 'linked') {
    await enrolFromLaunch({ courseId: target.courseId, userId, roles: identity.roles });

    /**
     * A deep link names the assignment it was created for, so it opens there rather than at the
     * course. Checked against this course before it is used: the claim travels through the
     * platform and could name an assignment somewhere else, and landing somebody on another
     * course's assignment would be a way to read work they should not see.
     */
    if (identity.assignmentId) {
      const assignment = await prisma.assignment.findFirst({
        where: { id: identity.assignmentId, courseId: target.courseId },
        select: { id: true },
      });
      if (assignment) {
        return `/dashboard/courses/${target.courseId}/${assignment.id}`;
      }
    }

    return `/dashboard/courses/${target.courseId}`;
  }

  if (target.status === 'needs-link') {
    const pending = await prisma.ltiPendingLink.create({
      data: {
        platformId: identity.platformId,
        contextId: identity.contextId!,
        contextTitle: identity.contextTitle,
        userId,
        expiresAt: new Date(Date.now() + PENDING_LINK_TTL_MS),
      },
      select: { id: true },
    });
    return `/lti/link?pending=${pending.id}`;
  }

  // Nothing to link, or nothing this person may do about it. The dashboard is a truthful
  // landing place: they are signed in, just not anywhere specific.
  return target.status === 'not-set-up' ? '/lti/link?notReady=1' : '/dashboard';
}
