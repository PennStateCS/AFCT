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
    async jwt({ token, user, req }) {
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

        // Optionally add ip/userAgent if needed
        const forwarded = req?.headers.get('x-forwarded-for');
        token.ipAddress = forwarded?.split(',')[0]?.trim() || req?.headers.get('x-real-ip') || null;
        token.userAgent = req?.headers.get('user-agent') || null;

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

        session.ipAddress = token.ipAddress as string;
        session.userAgent = token.userAgent as string;
      }

      if (token.exp) {
        session.expires = new Date(token.exp * 1000).toISOString();
      }

      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
