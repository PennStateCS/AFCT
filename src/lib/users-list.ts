import { prisma } from '@/lib/prisma';

export type UserListItem = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  temporaryPassword: boolean;
  isAdmin: boolean;
  avatar: string | null;
  cropX: number | null;
  cropY: number | null;
  zoom: number | null;
  timezone: string | null;
  inactive: boolean;
  lastLogin: Date | null;
  // Auto-expiring login lock. A future value means the account is locked out; the admin
  // UI shows a countdown and an unlock action. Past/null means not locked.
  lockedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function getUsersList(): Promise<UserListItem[]> {
  return prisma.user.findMany({
    orderBy: [{ lastName: 'asc' }],
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      temporaryPassword: true,
      isAdmin: true,
      avatar: true,
      cropX: true,
      cropY: true,
      zoom: true,
      timezone: true,
      inactive: true,
      lastLogin: true,
      lockedUntil: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
