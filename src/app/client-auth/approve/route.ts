import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/api/http';
import { createClientAuthCode, validateClientRedirectUri } from '@/lib/client-auth-codes';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { logError } from '@/lib/api/activity';
import { ClientAuthRequestSchema } from '@/schemas/client';

/**
 * The consent page's Allow action. Everything is re-validated here from scratch,
 * including the session and its gates: the form fields are client-controlled, and
 * the page having rendered proves nothing about the request this route receives.
 * On success the browser is sent to the loopback redirect with a single-use code;
 * the client then trades it at /api/client/v1/auth/exchange.
 *
 * CSRF: the session cookie is SameSite=Lax, which browsers do not attach to
 * cross-site POSTs, so a hostile page cannot submit this form with the student's
 * session. (A hostile LOCAL process does not need to: it can open the real consent
 * page, which is why the page names the account and says what approving grants.)
 */
export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user || session.user.inactive) {
      return apiError(401, 'Sign in first.');
    }
    if (session.user.mustChangePassword) {
      // The one gate the dashboard layout normally provides; without it a
      // temporary-password account could approve itself a 30-day token here.
      return apiError(403, 'Your password must be changed before approving a sign-in.');
    }

    const form = await req.formData();
    const parsed = ClientAuthRequestSchema.safeParse({
      redirect_uri: form.get('redirect_uri'),
      state: form.get('state'),
      code_challenge: form.get('code_challenge'),
      code_challenge_method: form.get('code_challenge_method'),
      device_name: form.get('device_name') ?? undefined,
    });
    const redirectUri = parsed.success
      ? validateClientRedirectUri(parsed.data.redirect_uri)
      : null;
    if (!parsed.success || !redirectUri) {
      await createEnhancedActivityLog(prisma, req, {
        userId: session.user.id,
        action: 'CLIENT_AUTH_APPROVE_REFUSED',
        severity: 'WARNING',
        category: 'USER',
        metadata: { reason: parsed.success ? 'redirect_uri' : 'malformed' },
      });
      return apiError(400, 'This sign-in request is not valid.');
    }

    const { code } = await createClientAuthCode(session.user.id, {
      pkceChallenge: parsed.data.code_challenge,
      redirectUri,
      deviceName: parsed.data.device_name ?? null,
    });

    // The grant is logged here, the sign-in itself at the exchange; refusals are
    // logged in both places. Under FERPA this consent is part of the access story.
    await createEnhancedActivityLog(prisma, req, {
      userId: session.user.id,
      action: 'CLIENT_AUTH_APPROVED',
      severity: 'INFO',
      category: 'USER',
      metadata: { label: parsed.data.device_name ?? null },
    });

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', parsed.data.state);
    return NextResponse.redirect(target, 303);
  } catch (error) {
    console.error('[CLIENT_AUTH_APPROVE_ERROR]', error);
    await logError(req, {
      userId: null,
      action: 'CLIENT_AUTH_APPROVE_ERROR',
      error,
      category: 'USER',
    });
    return apiError(500, 'Internal server error');
  }
}
