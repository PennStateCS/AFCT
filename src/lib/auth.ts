import NextAuth from 'next-auth';
import { headers } from 'next/headers';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getClientIpFromHeaders } from '@/lib/ip-utils';
import { getClientIp } from '@/lib/security/rate-limiter';
import { verifyCredentials } from '@/lib/credentials';
import { getSessionUser } from '@/lib/session-user-cache';
import { isSessionIdleExpired } from '@/lib/session-timeout';
import { getServerIdleTimeoutMs } from '@/lib/session-timeout.server';
import { requireAuthSecret } from '@/lib/auth-secret';
import { passwordChangedSinceToken } from '@/lib/session-password';
import type { Adapter } from 'next-auth/adapters';

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma) as unknown as Adapter,
  providers: [
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
    async jwt({ token, user, trigger }) {
      if (user) {
        token.isAdmin = user.isAdmin;
        token.id = user.id;
        token.avatar = user.avatar;
        token.mustChangePassword = Boolean(user.mustChangePassword);
        // Store firstName and lastName separately for better component access
        if (user.email) {
          // Fetch the full user data to get firstName/lastName
          const fullUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { firstName: true, lastName: true, passwordChangedAt: true },
          });
          token.firstName = fullUser?.firstName || undefined;
          token.lastName = fullUser?.lastName || undefined;
          // Snapshot the password-change instant so a later change/reset revokes
          // this token (see the session callback).
          token.pwChangedAt = fullUser?.passwordChangedAt
            ? fullUser.passwordChangedAt.getTime()
            : null;
        }
        // Start the idle clock at sign-in.
        token.lastActivity = Date.now();
        token.idleTimeoutMs = await getServerIdleTimeoutMs();
      }

      // Explicit activity heartbeat from the client (`update()`): refresh the idle
      // clock, but never revive a session that has already gone idle-expired.
      if (trigger === 'update') {
        const now = Date.now();
        if (!isSessionIdleExpired(token.lastActivity, token.idleTimeoutMs, now)) {
          token.lastActivity = now;
          token.idleTimeoutMs = await getServerIdleTimeoutMs(now);
        }
      }

      // Backfill tokens issued before idle tracking existed so a deploy doesn't
      // instantly sign everyone out; treat them as active as of now.
      if (typeof token.lastActivity !== 'number') {
        token.lastActivity = Date.now();
      }
      if (typeof token.idleTimeoutMs !== 'number') {
        token.idleTimeoutMs = await getServerIdleTimeoutMs();
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.isAdmin = Boolean(token.isAdmin);
        session.user.avatar = (token.avatar as string | null) || undefined;

        // Idle-timeout backstop mirroring the edge middleware: a token whose last
        // activity is older than its idle limit must not grant access. The client
        // watcher normally signs out first; this covers server-side consumers
        // (`auth()`, the route wrappers) if it doesn't.
        if (isSessionIdleExpired(token.lastActivity, token.idleTimeoutMs, Date.now())) {
          session.user.isAdmin = false;
          session.user.inactive = true;
          session.user.firstName = token.firstName as string | undefined;
          session.user.lastName = token.lastName as string | undefined;
          session.user.mustChangePassword = Boolean(token.mustChangePassword);
          return session;
        }

        // Always fetch fresh user data to ensure profile updates are reflected,
        // and, critically, to catch an account that has since been deleted or
        // disabled so a stale JWT can't keep granting access (especially admin).
        try {
          // Served from a seconds-long cache so one dashboard load's parallel API
          // calls share a single read. Deactivation, password changes and admin
          // changes evict the entry, so revocation stays effectively immediate;
          // the TTL is only the backstop. See lib/session-user-cache.
          const freshUser = await getSessionUser(token.id as string);

          // Revoke a session whose password changed after the token was issued
          // (a reset/change must terminate existing sessions, not just future ones).
          if (
            freshUser &&
            !freshUser.inactive &&
            !passwordChangedSinceToken(token.pwChangedAt, freshUser.passwordChangedAt)
          ) {
            session.user.firstName = freshUser.firstName || undefined;
            session.user.lastName = freshUser.lastName || undefined;
            session.user.isAdmin = freshUser.isAdmin;
            session.user.avatar = freshUser.avatar || undefined;
            session.user.mustChangePassword = freshUser.temporaryPassword;
            session.user.inactive = false;
            session.user.cropX = freshUser.cropX ?? undefined;
            session.user.cropY = freshUser.cropY ?? undefined;
            session.user.zoom = freshUser.zoom ?? undefined;
            // Update the combined name as well
            session.user.name =
              `${freshUser.firstName || ''} ${freshUser.lastName || ''}`.trim() || undefined;
          } else {
            // The account is gone or disabled: revoke access. Strip privileges and
            // mark the session inactive so the auth wrappers (and any consumer that
            // checks it) reject it, rather than trusting the stale token.
            session.user.isAdmin = false;
            session.user.inactive = true;
            session.user.firstName = token.firstName as string | undefined;
            session.user.lastName = token.lastName as string | undefined;
            session.user.mustChangePassword = Boolean(token.mustChangePassword);
          }
        } catch (error) {
          console.error('Error fetching fresh user data:', error);
          // On a transient DB error we fail OPEN for availability (keep the user
          // signed in, a blip shouldn't log everyone out) but CLOSED for
          // privilege: strip admin. The fresh-user lookup is also the admin-
          // revocation path, so trusting the token's isAdmin here would let a
          // just-de-admined user keep elevated access during an outage. `isAdmin`
          // was set from the token above (line ~171); force it off.
          session.user.isAdmin = false;
          session.user.firstName = token.firstName as string | undefined;
          session.user.lastName = token.lastName as string | undefined;
          session.user.mustChangePassword = Boolean(token.mustChangePassword);
        }
      }
      return session;
    },
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
          { userId, action: 'LOGOUT', category: 'SYSTEM', severity: 'INFO', metadata: {} },
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
    maxAge: 24 * 60 * 60, // 24 hours
    updateAge: 60 * 60, // 1 hour - update session if older than this
  },
  jwt: {
    maxAge: 24 * 60 * 60, // 24 hours
  },
  secret: requireAuthSecret(),
});

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

