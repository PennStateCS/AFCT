import { PrismaAdapter } from '@next-auth/prisma-adapter';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcrypt';
import type { NextAuthOptions } from 'next-auth';
import { Role } from '@prisma/client';
import type { User } from 'next-auth';

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60, // 1 hour
    updateAge: 0, // ensure token is refreshed immediately on update
  },
  jwt: {
    maxAge: 60 * 60,
  },
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
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },

      async authorize(credentials): Promise<User | null> {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({ where: { email: credentials.email } });
        if (!user || !user.password) return null;

        const valid = await bcrypt.compare(credentials.password, user.password);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          avatar: user.avatar,
          name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
          image: user.avatar,
        } as User;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, merge user fields into token
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = user.role;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.avatar = user.avatar;
        token.name = user.name;
        token.image = user.avatar;

        // Set token expiration
        token.exp = Math.floor(Date.now() / 1000) + 60 * 30;
      }

      // Always return the full token, keeping existing values!
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.role = token.role as Role;
        session.user.firstName = token.firstName as string;
        session.user.lastName = token.lastName as string;
        session.user.avatar = token.avatar as string;
        session.user.name = token.name as string;
        session.user.image = token.image as string;
      }

      if (token.exp) {
        session.expires = new Date(token.exp * 1000).toISOString();
      }

      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
