import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'
import { Role } from '@prisma/client'

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        const user = await prisma.user.findUnique({ 
          where: { email: credentials.email as string, inactive: false } 
        })

        if (!user) {
          return null
        }

        const valid = await bcrypt.compare(credentials.password as string, user.password)

        if (!valid) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
          role: user.role,
          avatar: user.avatar || undefined,
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.id = user.id
        token.avatar = user.avatar
        // Store firstName and lastName separately for better component access
        if (user.email) {
          // Fetch the full user data to get firstName/lastName
          const fullUser = await prisma.user.findUnique({
            where: { email: user.email },
            select: { firstName: true, lastName: true }
          })
          token.firstName = fullUser?.firstName || undefined
          token.lastName = fullUser?.lastName || undefined
        }
      }
      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.role = token.role as Role
        session.user.avatar = (token.avatar as string | null) || undefined
        
        // Always fetch fresh user data to ensure profile updates are reflected
        try {
          const freshUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { firstName: true, lastName: true, role: true, avatar: true }
          })
          
          if (freshUser) {
            session.user.firstName = freshUser.firstName || undefined
            session.user.lastName = freshUser.lastName || undefined
            session.user.role = freshUser.role
            session.user.avatar = freshUser.avatar || undefined
            // Update the combined name as well
            session.user.name = `${freshUser.firstName || ''} ${freshUser.lastName || ''}`.trim() || undefined
          } else {
            // Fallback to token data if user not found
            session.user.firstName = token.firstName as string | undefined
            session.user.lastName = token.lastName as string | undefined
          }
        } catch (error) {
          console.error('Error fetching fresh user data:', error)
          // Fallback to token data on error
          session.user.firstName = token.firstName as string | undefined
          session.user.lastName = token.lastName as string | undefined
        }
      }
      return session
    }
  },
  events: {
    async signIn({ user, account }) {
      try {
        await prisma.activityLog.create({
          data: {
            userId: user?.id ?? undefined,
            action: 'LOGIN_SUCCESS',
            category: 'SYSTEM',
            metadata: { email: user?.email ?? null, provider: account?.provider ?? null },
          },
        });
      } catch (e) {
        // don't block sign-in on logging failure
        console.error('Failed to log signIn event:', e);
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
})
