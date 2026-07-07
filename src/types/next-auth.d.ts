import type { DefaultSession, DefaultUser } from 'next-auth';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      email: string;
      isAdmin: boolean;
      firstName?: string;
      lastName?: string;
      avatar?: string;
      timezone?: string;
      mustChangePassword?: boolean;
      name?: string;
      image?: string;
      ipAddress?: string;
      userAgent?: string;
    } & DefaultSession['user'];

    ipAddress?: string;
    userAgent?: string;
  }

  interface User extends DefaultUser {
    id: string;
    email: string;
    isAdmin: boolean;
    firstName?: string;
    lastName?: string;
    avatar?: string;
    timezone?: string;
    mustChangePassword?: boolean;
    name?: string;
    image?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    email: string;
    isAdmin: boolean;
    firstName?: string;
    lastName?: string;
    avatar?: string;
    timezone?: string;
    mustChangePassword?: boolean;
    name?: string;
    image?: string;
    ipAddress?: string;
    userAgent?: string;
    exp?: number;
  }
}

/** Represents the authenticated session user */
export type SessionUser = Session['user'];

/** Minimal authenticated identity, often passed in props */
export type AuthIdentity = Pick<SessionUser, 'id' | 'email'>;

/** Represents request metadata often logged in activity logs */
export type RequestMetadata = {
  ipAddress: string;
  userAgent: string;
};

export {};
