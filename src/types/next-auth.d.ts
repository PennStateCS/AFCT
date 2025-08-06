import { Role } from '@prisma/client';

declare module 'next-auth' {
  interface Session extends DefaultSession {
    user: {
      id: string;
      role: Role;
      firstName?: string;
      lastName?: string;
      avatar?: string;
      ipAddress?: string;
      userAgent?: string;
    } & DefaultSession['user'];
  }

  interface User extends DefaultUser {
    id: string;
    role: Role;
    firstName?: string;
    lastName?: string;
    avatar?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: Role;
    email: string;
    firstName?: string;
    lastName?: string;
    avatar?: string;
    ipAddress?: string;
    userAgent?: string;
  }
}

export {};
