// app/api/auth/[...nextauth]/route.ts

import NextAuth from 'next-auth';
import { prisma } from '@/lib/prisma';
import { authOptions as baseAuthOptions } from '@/lib/authOptions';

// Extend authOptions
export const authOptions = {
  ...baseAuthOptions,

  events: {
    // Log signin
    async signIn({ user, account, isNewUser }) {
      try {
        await prisma.activityLog.create({
          data: {
            userId: user.id,
            action: 'USER_SIGNIN',
            metadata: {
              provider: account?.provider,
              isNewUser,
              ipAddress: account?.ipAddress ?? null, // Optional, inject via middleware if needed
              userAgent: account?.userAgent ?? null, // Optional, inject via middleware if needed
            },
          },
        });
      } catch (error) {
        console.error('[SIGNIN_LOG_ERROR]', error);
      }
    },

    // Log signout
    async signOut({ token }) {
      try {
        if (!token?.sub) return;

        await prisma.activityLog.create({
          data: {
            userId: token.sub,
            action: 'USER_SIGNOUT',
            metadata: {
              ipAddress: token?.ipAddress ?? null, // Optional
              userAgent: token?.userAgent ?? null, // Optional
            },
          },
        });
      } catch (error) {
        console.error('[SIGNOUT_LOG_ERROR]', error);
      }
    },

    // Log signin failure
    async error({ error, message }) {
      try {
        await prisma.activityLog.create({
          data: {
            userId: null,
            action: 'SIGNIN_FAILURE',
            metadata: {
              error: error?.message || message || 'Unknown authentication error',
            },
          },
        });
      } catch (logError) {
        console.error('[SIGNIN_FAILURE_LOG_ERROR]', logError);
      }
    },

    // Logs new user
    async createUser({ user }) {
      try {
        await prisma.activityLog.create({
          data: {
            userId: user.id,
            action: 'USER_CREATED',
            metadata: {},
          },
        });
      } catch (error) {
        console.error('[USER_CREATION_LOG_ERROR]', error);
      }
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
