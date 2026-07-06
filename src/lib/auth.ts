import NextAuth from 'next-auth';
import { headers } from 'next/headers';
import { PrismaAdapter } from '@auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { inferSeverity } from '@/lib/activity-log-utils';
import { getClientIpFromHeaders } from '@/lib/ip-utils';
import {
  applyBotFriction,
  evaluateLoginRateLimit,
  getClientIp,
  recordLoginSuccess,
} from '@/lib/security/rate-limiter';
import { verifyCaptchaToken } from '@/lib/security/captcha';
import { getLoginLockoutPolicy } from '@/lib/login-policy';
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
        const emailInput = (credentials?.email as string | undefined)?.trim().toLowerCase();
        const interactionMs = Number(
          (credentials as Record<string, unknown> | undefined)?.interactionMs,
        );
        const ipAddress = getClientIp(request ?? undefined);
        const captchaToken = (credentials as Record<string, unknown> | undefined)?.captchaToken as
          | string
          | undefined;

        if (!emailInput || !credentials?.password) {
          void logSecurityEvent('LOGIN_FAILED', {
            ip: ipAddress,
            identifier: emailInput,
            reason: 'missing credentials',
          });
          return null;
        }

        const accountLimit = await getLoginLockoutPolicy();
        const rateDecision = evaluateLoginRateLimit({
          ip: ipAddress,
          identifier: emailInput,
          interactionMs: Number.isFinite(interactionMs) ? interactionMs : undefined,
          accountLimit,
        });

        if (rateDecision.status === 'blocked') {
          void logSecurityEvent('LOGIN_RATE_LIMIT', {
            ip: ipAddress,
            identifier: emailInput,
          });
          throw new Error('RateLimitExceeded');
        }

        if (rateDecision.status === 'challenge') {
          const captchaValid = await verifyCaptchaToken(captchaToken, ipAddress);
          if (!captchaValid) {
            void logSecurityEvent('LOGIN_CHALLENGE_REQUIRED', {
              ip: ipAddress,
              identifier: emailInput,
            });
            throw new Error('BotChallengeRequired');
          }
          void logSecurityEvent('LOGIN_CHALLENGE_SOLVED', {
            ip: ipAddress,
            identifier: emailInput,
          });
        }

        if (rateDecision.status === 'ok' && rateDecision.applyFriction) {
          await applyBotFriction(rateDecision.frictionDelayMs);
        }

        const user = await prisma.user.findFirst({
          where: {
            email: emailInput,
            inactive: false,
          },
        });

        if (!user) {
          // No active account matches — unknown email or a disabled account.
          void logSecurityEvent('LOGIN_FAILED', {
            ip: ipAddress,
            identifier: emailInput,
            reason: 'unknown or inactive account',
          });
          return null;
        }

        const valid = await bcrypt.compare(credentials.password as string, user.password);

        if (!valid) {
          void logSecurityEvent(
            'LOGIN_FAILED',
            { ip: ipAddress, identifier: emailInput, reason: 'invalid password' },
            user.id,
          );
          return null;
        }

        recordLoginSuccess({ ip: ipAddress, identifier: emailInput });

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          role: user.role,
          avatar: user.avatar || undefined,
          mustChangePassword: user.temporaryPassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.id = user.id;
        token.avatar = user.avatar;
        token.mustChangePassword = Boolean(user.mustChangePassword);
        // Store firstName and lastName separately for better component access
        if (user.email) {
          // Fetch the full user data to get firstName/lastName
          const fullUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { firstName: true, lastName: true },
          });
          token.firstName = fullUser?.firstName || undefined;
          token.lastName = fullUser?.lastName || undefined;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.avatar = (token.avatar as string | null) || undefined;

        // Always fetch fresh user data to ensure profile updates are reflected
        try {
          const freshUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: {
              firstName: true,
              lastName: true,
              role: true,
              avatar: true,
              temporaryPassword: true,
            },
          });

          if (freshUser) {
            session.user.firstName = freshUser.firstName || undefined;
            session.user.lastName = freshUser.lastName || undefined;
            session.user.role = freshUser.role;
            session.user.avatar = freshUser.avatar || undefined;
            session.user.mustChangePassword = freshUser.temporaryPassword;
            // Update the combined name as well
            session.user.name =
              `${freshUser.firstName || ''} ${freshUser.lastName || ''}`.trim() || undefined;
          } else {
            // Fallback to token data if user not found
            session.user.firstName = token.firstName as string | undefined;
            session.user.lastName = token.lastName as string | undefined;
            session.user.mustChangePassword = Boolean(token.mustChangePassword);
          }
        } catch (error) {
          console.error('Error fetching fresh user data:', error);
          // Fallback to token data on error
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
      try {
        const mustChangePassword = Boolean(
          (user as { mustChangePassword?: boolean } | undefined)?.mustChangePassword,
        );

        await prisma.activityLog.create({
          data: {
            userId: user?.id ?? undefined,
            action: 'LOGIN_SUCCESS',
            category: 'SYSTEM',
            severity: inferSeverity('LOGIN_SUCCESS'),
            ipAddress,
            userAgent,
            metadata: {
              email: user?.email ?? null,
              provider: account?.provider ?? null,
              mustChangePassword,
              temporaryPasswordLogin: mustChangePassword,
            },
          },
        });
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
        await prisma.activityLog.create({
          data: {
            userId,
            action: 'LOGOUT',
            category: 'SYSTEM',
            severity: inferSeverity('LOGOUT'),
            ipAddress,
            userAgent,
            metadata: {},
          },
        });
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
  secret: process.env.NEXTAUTH_SECRET,
});

type SecurityEventAction =
  | 'LOGIN_RATE_LIMIT'
  | 'LOGIN_CHALLENGE_REQUIRED'
  | 'LOGIN_CHALLENGE_SOLVED'
  | 'LOGIN_FAILED';

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

const logSecurityEvent = async (
  action: SecurityEventAction,
  metadata: { ip?: string; identifier?: string; reason?: string },
  userId?: string | null,
) => {
  try {
    await prisma.activityLog.create({
      data: {
        userId: userId ?? null,
        action,
        category: 'SECURITY',
        severity: inferSeverity(action),
        // Promote the known client IP into the column (not just metadata).
        ipAddress: metadata.ip ?? null,
        metadata,
      },
    });
  } catch (error) {
    console.error('[auth] security log failure', error);
  }
};
