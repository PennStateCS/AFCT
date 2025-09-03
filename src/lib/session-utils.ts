import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcrypt'
import { Role } from '@prisma/client'

// Optional: small helper to log once
const dbg = (...args: any[]) => process.env.NODE_ENV !== 'production' && console.log('[auth]', ...args)

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),

  // In Docker/WSL dev this helps avoid host-origin issues
  trustHost: true,

  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
    async authorize(credentials) {
        try {
      const creds = credentials as { email?: string; password?: string } | undefined
      const email = String(creds?.email ?? '').toLowerCase().trim()
      const password = String(creds?.password ?? '').trim()

          if (!email || !password) {
            dbg('missing email or password')
            return null
          }

          const user = await prisma.user.findUnique({ where: { email } })
          if (!user) {
            dbg('user not found:', email)
            return null
          }

          const valid = await bcrypt.compare(password, user.password)
          if (!valid) {
            dbg('invalid password for:', email)
            return null
          }

          // Return minimal safe user object
          return {
            id: user.id,
            email: user.email,
            name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.email,
            role: user.role,
            avatar: user.avatar || undefined,
          }
        } catch (err) {
          console.error('[auth] authorize error:', err)
          // Returning null signals invalid creds (vs throwing a 500)
          return null
        }
      }
    })
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as any).role
        token.id = (user as any).id
        token.avatar = (user as any).avatar

        // fetch names once to put into token (saves a query later)
        if ((user as any).email) {
          try {
            const full = await prisma.user.findUnique({
              where: { email: (user as any).email },
              select: { firstName: true, lastName: true }
            })
            token.firstName = full?.firstName || undefined
            token.lastName = full?.lastName || undefined
          } catch (e) {
            dbg('jwt name fetch failed:', e)
          }
        }
      }
      return token
    },

    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as Role
        session.user.avatar = (token.avatar as string | null) || undefined

        // Option A (lighter): trust token values for names
        session.user.firstName = token.firstName as string | undefined
        session.user.lastName = token.lastName as string | undefined
        session.user.name =
          `${session.user.firstName || ''} ${session.user.lastName || ''}`.trim() || session.user.name

        // Option B (heavier): always refetch user — comment out if not needed
        // try {
        //   const fresh = await prisma.user.findUnique({
        //     where: { id: token.id as string },
        //     select: { firstName: true, lastName: true, role: true, avatar: true }
        //   })
        //   if (fresh) {
        //     session.user.firstName = fresh.firstName || undefined
        //     session.user.lastName  = fresh.lastName  || undefined
        //     session.user.role      = fresh.role
        //     session.user.avatar    = fresh.avatar || undefined
        //     session.user.name      = `${fresh.firstName || ''} ${fresh.lastName || ''}`.trim() || session.user.name
        //   }
        // } catch (e) {
        //   console.error('Error fetching fresh user data:', e)
        // }
      }
      return session
    }
  },

  events: {
    async signIn({ user, account, }) {
      try {
        // Be defensive: user.id may not exist or be stale in dev
        const userId = (user as any)?.id ?? null
        // If you added the safer logger helper, call it here instead.
        await prisma.activityLog.create({
          data: {
            userId: userId, // nullable in your schema; ok if null
            action: 'LOGIN_SUCCESS',
            category: 'SYSTEM',
            metadata: { email: (user as any)?.email ?? null, provider: account?.provider ?? null },
          },
        })
      } catch (e: any) {
        // Don’t block sign-in if logging fails
        if (e?.code === 'P2003') {
          console.warn('[auth] signIn log skipped (FK violation)')
        } else {
          console.error('Failed to log signIn event:', e)
        }
      }
    },
  },

  pages: {
    signIn: '/login',
  },

  session: {
    strategy: 'jwt',
    maxAge: 24 * 60 * 60,
    updateAge: 60 * 60,
  },

  jwt: {
    maxAge: 24 * 60 * 60,
  },

  secret: process.env.NEXTAUTH_SECRET,
})
