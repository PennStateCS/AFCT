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
      /**
       * True when the account is disabled or no longer exists. The session
       * callback sets this from the DB on every request; the auth wrappers reject
       * a session whose user is inactive, so a disabled/deleted user loses access
       * without waiting for the JWT to expire.
       */
      inactive?: boolean;
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
    /**
     * Server-clock timestamp (ms) of the last activity heartbeat. Refreshed only
     * by an explicit client `update()` ping, never by passive session reads, so
     * background polling doesn't keep an idle session alive.
     */
    lastActivity?: number;
    /** The idle limit (ms) the server enforces against {@link lastActivity}. */
    idleTimeoutMs?: number;
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
