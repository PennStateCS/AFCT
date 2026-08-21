import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import { headers } from 'next/headers';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getClientIpFromHeaders } from '@/lib/ip-utils';
import { getClientIp } from '@/lib/security/rate-limiter';
import { verifyCredentials } from '@/lib/credentials';
import { redeemSessionTicket } from '@/lib/lti/session-ticket';
import { framedAuthCookies, hasFrameMarker } from '@/lib/lti/frame-session';
import { requireAuthSecret } from '@/lib/auth-secret';
import { buildJwtToken, buildSession } from '@/lib/auth-callbacks';
import { buildOidcProvider, getOidcConfig, OIDC_PROVIDER_ID } from '@/lib/oidc-provider';
import { resolveOidcSignIn } from '@/lib/oidc-signin';
import { linkIdentity, isWriteConflict } from '@/lib/linked-identity';

/**
 * The config is a function rather than an object because institutional sign-in is configured by
 * an administrator at runtime, not at build time. NextAuth calls this per request, so turning
 * the provider on takes effect without a restart, and an install that never configures one
 * simply has no such provider.
 */
/**
 * The config NextAuth asks for on every request.
 *
 * Exported so the parts of it that are decisions rather than wiring can be tested: whether a
 * framed launch gets the widened cookies is one, and it is the join between two pieces that are
 * each tested on their own and would agree with each other whether or not they were connected.
 */
export async function buildAuthConfig(): Promise<NextAuthConfig> {
  const oidc = await getOidcConfig();
  /**
   * Widen the sign-in cookies only for a request that is inside an LMS frame.
   *
   * The marker is set at the edge on the one request where being framed is visible, and is
   * partitioned, so this cannot be turned on by an ordinary visitor or by another site. See
   * `lib/lti/frame-session` for why the alternative, `SameSite=None` for everybody, is worse.
   */
  const framed = await isFramedLaunch();

  return {
    ...(framed ? { cookies: framedAuthCookies() } : {}),
    /**
     * No adapter, deliberately.
     *
     * Auth.js's adapter owns identity in its own `Account`/`Session`/`User` tables. AFCT owns
     * it in `LinkedIdentity`, keyed by issuer and subject, with JWT sessions and its own
     * resolution rules (an address is only ever used for the first match, an administrator is
     * never attached automatically). Installing both makes two sources of truth, and the schema
     * has never carried Auth.js's tables, so the adapter it was given could not answer at all:
     * an OIDC callback calls `getUserByAccount` *before* the `signIn` callback below, which
     * meant every institutional sign-in failed inside Auth.js before any AFCT code ran.
     *
     * Nothing else needs it. Credentials providers (the password form, the LTI ticket) skip the
     * adapter entirely, sessions are JWTs, and there is no email provider.
     */
    providers: [
      ...(oidc ? [buildOidcProvider(oidc)] : []),
      /**
       * Completing an LTI launch. Not a password: the launch endpoint has already verified a
       * signed token, and this only spends the single-use ticket it handed out.
       */
      CredentialsProvider({
        id: 'lti-launch',
        name: 'LTI launch',
        credentials: { ticket: { label: 'Ticket', type: 'text' } },
        async authorize(credentials) {
          const raw = credentials as Record<string, unknown> | undefined;
          return await redeemSessionTicket(raw?.ticket as string | undefined);
        },
      }),
      CredentialsProvider({
        name: 'credentials',
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        async authorize(credentials, request) {
          const raw = credentials as Record<string, unknown> | undefined;
          const result = await verifyCredentials({
            email: raw?.email as string | undefined,
            password: raw?.password as string | undefined,
            ipAddress: getClientIp(request ?? undefined),
            interactionMs: Number(raw?.interactionMs),
            captchaToken: raw?.captchaToken as string | undefined,
          });

          if (!result.ok) {
            // Map the shared result onto the sentinel errors the login UI expects; a
            // plain `null` is a generic invalid-credentials rejection.
            if (result.reason === 'rate_limited') throw new Error('RateLimitExceeded');
            if (result.reason === 'challenge_required') throw new Error('BotChallengeRequired');
            return null;
          }

          const { user } = result;
          return {
            id: user.id,
            email: user.email,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
            isAdmin: user.isAdmin,
            avatar: user.avatar || undefined,
            mustChangePassword: user.mustChangePassword,
          };
        },
      }),
    ],
    callbacks: {
      /**
       * Decides who an institutional sign-in is, and whether it is allowed at all.
       *
       * Only the OIDC provider goes through here. The credentials provider has already done its
       * own checking in `verifyCredentials`, and re-deciding it here would mean two places that
       * have to agree about who may sign in.
       *
       * Returning a string redirects with a reason the sign-in page can explain. Returning false
       * would show NextAuth's generic error, which tells somebody nothing about what to do.
       */
      async signIn({ user, account, profile }) {
        if (account?.provider !== OIDC_PROVIDER_ID) return true;

        const config = await getOidcConfig();
        // The provider cannot have produced this callback if it is not configured, so this is a
        // race with an admin switching it off mid-sign-in rather than a state worth explaining.
        if (!config) return `/login?error=oidc`;

        const claims = profile as Record<string, unknown> | undefined;
        const { ipAddress, userAgent } = await getRequestContext();
        const subject = String(claims?.sub ?? account.providerAccountId);

        /**
         * Already signed in, so this is somebody connecting their institution rather than
         * signing in with it. That is the only way an administrator ever gets an identity,
         * since automatic linking refuses them by design.
         *
         * Safe because both halves are proved in the same moment: the session says who they
         * are here, the provider has just said who they are there, and `linkIdentity` still
         * refuses an identity that belongs to a different account.
         */
        const current = await auth();
        if (current?.user?.id && !current.user.inactive) {
          const linked = await linkIdentity({
            ref: { kind: 'OIDC', issuer: config.issuer, subject },
            userId: current.user.id,
            via: 'SELF_SERVICE',
            actorUserId: current.user.id,
            context: { ipAddress, userAgent },
          });
          return linked.ok
            ? '/dashboard/account?linked=1'
            : `/dashboard/account?error=${linked.reason}`;
        }

        let outcome;
        try {
          outcome = await resolveOidcSignIn({
            claims: {
              issuer: config.issuer,
              subject,
              email: (claims?.email as string | undefined) ?? user?.email ?? null,
              emailVerified: claims?.email_verified === true,
              firstName: (claims?.given_name as string | undefined) ?? null,
              lastName: (claims?.family_name as string | undefined) ?? null,
            },
            trustEmail: config.trustEmail,
            context: { ipAddress, userAgent },
          });
        } catch (error) {
          /**
           * The account was being changed while this sign-in was deciding, twice over, so
           * linking gave up rather than guessing. Nothing was established about the account, so
           * the reason deliberately names none: it falls to the generic "try again, or use your
           * AFCT password" message. This used to arrive as `account-inactive`, which sent people
           * to an administrator for an account that was perfectly fine.
           */
          if (!isWriteConflict(error)) throw error;
          console.error('[oidc] sign-in could not be settled:', error);
          return `/login?error=oidc&reason=try-again`;
        }

        if (!outcome.ok) {
          await createEnhancedActivityLog(
            prisma,
            { ipAddress, userAgent },
            {
              userId: null,
              action: 'OIDC_SIGN_IN_DENIED',
              severity: 'SECURITY',
              category: 'USER',
              metadata: { issuer: config.issuer, reason: outcome.reason },
            },
          );
          return `/login?error=oidc&reason=${outcome.reason}`;
        }

        // The account this sign-in belongs to, which is not necessarily the one NextAuth would
        // have inferred: it resolves by identity, and by email only the first time.
        user.id = outcome.userId;
        return true;
      },
      // Both live in lib/auth-callbacks so they can be unit-tested directly; importing
      // this module would otherwise pull in all of NextAuth's initialization.
      jwt: buildJwtToken,
      session: buildSession,
    },
    events: {
      async signIn({ user, account }) {
        const { ipAddress, userAgent } = await getRequestContext();

        // Record the last successful sign-in. Best-effort: never block sign-in on it.
        if (user?.id) {
          try {
            await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
          } catch (e) {
            console.error('Failed to update lastLogin:', e);
          }
        }

        try {
          const mustChangePassword = Boolean(
            (user as { mustChangePassword?: boolean } | undefined)?.mustChangePassword,
          );

          await createEnhancedActivityLog(
            prisma,
            { ipAddress, userAgent },
            {
              userId: user?.id ?? null,
              action: 'LOGIN_SUCCESS',
              category: 'SYSTEM',
              severity: 'INFO',
              metadata: {
                email: user?.email ?? null,
                provider: account?.provider ?? null,
                mustChangePassword,
                temporaryPasswordLogin: mustChangePassword,
              },
            },
          );
        } catch (e) {
          // don't block sign-in on logging failure
          console.error('Failed to log signIn event:', e);
        }
      },
      async signOut(message) {
        const { ipAddress, userAgent } = await getRequestContext();
        try {
          // JWT strategy: the signed-out user's token is provided.
          const token = (message as { token?: { id?: unknown } | null }).token;
          const userId = typeof token?.id === 'string' ? token.id : null;
          await createEnhancedActivityLog(
            prisma,
            { ipAddress, userAgent },
            {
              userId,
              action: 'LOGOUT',
              category: 'SYSTEM',
              severity: 'INFO',
              // Where the session came from, carried on the token since sign-in: a logout that
              // cannot say what it ended leaves somebody reading the log to guess.
              metadata: {
                ...(typeof (token as { provider?: unknown })?.provider === 'string'
                  ? { provider: (token as { provider: string }).provider }
                  : {}),
              },
            },
          );
        } catch (e) {
          // don't block sign-out on logging failure
          console.error('Failed to log signOut event:', e);
        }
      },
    },
    pages: {
      signIn: '/login',
    },
    session: {
      strategy: 'jwt',
      // Rolling: an active session is re-issued and the clock starts again, so this bounds a
      // gap in use rather than the session's whole life. The life is bounded separately, by
      // `ABSOLUTE_SESSION_MAX_AGE_MS` and the `authTime` stamped at sign-in.
      maxAge: 12 * 60 * 60, // 12 hours
      updateAge: 60 * 60, // 1 hour - update session if older than this
    },
    jwt: {
      maxAge: 12 * 60 * 60, // 12 hours
    },
    secret: requireAuthSecret(),
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(buildAuthConfig);


/**
 * Whether this request carries the framed-launch marker.
 *
 * Best effort: the headers are only readable while a request is being handled, and a
 * programmatic call outside one is treated as not framed, which is the safe answer.
 */
async function isFramedLaunch(): Promise<boolean> {
  try {
    return hasFrameMarker((await headers()).get('cookie'));
  } catch {
    return false;
  }
}

/**
 * Best-effort request context for the NextAuth events, which don't receive the
 * request object. `next/headers` is available while an auth route handler is
 * running; if it isn't (e.g. a programmatic sign-out), we log without it.
 */
const getRequestContext = async (): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> => {
  try {
    const h = await headers();
    return { ipAddress: getClientIpFromHeaders(h), userAgent: h.get('user-agent') };
  } catch {
    return { ipAddress: null, userAgent: null };
  }
};
