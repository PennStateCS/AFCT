import { Role } from '@prisma/client';
import type { DefaultSession, DefaultUser } from 'next-auth';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      email: string;
      role: Role;
      firstName?: string;
      lastName?: string;
      avatar?: string;
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
    role: Role;
    firstName?: string;
    lastName?: string;
    avatar?: string;
    name?: string;
    image?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    email: string;
    role: Role;
    firstName?: string;
    lastName?: string;
    avatar?: string;
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
export type AuthIdentity = Pick<SessionUser, 'id' | 'role' | 'email'>;

/** Utility type for checking role-based access */
export type AdminOnly = Extract<Role, 'ADMIN'>;
export type StaffRole = Extract<Role, 'ADMIN' | 'FACULTY' | 'TA'>;
export type StudentRole = Extract<Role, 'STUDENT'>;

/** Represents request metadata often logged in activity logs */
export type RequestMetadata = {
  ipAddress: string;
  userAgent: string;
};

export {};
