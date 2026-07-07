import { prisma } from '@/lib/prisma';

export type UserListItem = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  temporaryPassword: boolean;
  isAdmin: boolean;
  avatar: string | null;
  timezone: string | null;
  inactive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function getUsersList(_role?: string | null): Promise<UserListItem[]> {
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
      timezone: true,
      inactive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
