import NextAuth from 'next-auth';
import { headers } from 'next/headers';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { createEnhancedActivityLog } from '@/lib/activity-log-utils';
import { getClientIpFromHeaders } from '@/lib/ip-utils';
import { getClientIp } from '@/lib/security/rate-limiter';
import { verifyCredentials } from '@/lib/credentials';
import { requireAuthSecret } from '@/lib/auth-secret';
import { buildJwtToken, buildSession } from '@/lib/auth-callbacks';
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

