import { prisma } from '@/lib/prisma';
import { Role } from '@prisma/client';

export type UserListItem = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  temporaryPassword: boolean;
  role: Role;
  avatar: string | null;
  timezone: string | null;
  inactive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export async function getUsersList(role?: string | null): Promise<UserListItem[]> {
  return prisma.user.findMany({
    where: role ? { role: role as Role } : undefined,
    orderBy: [{ role: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      temporaryPassword: true,
      role: true,
      avatar: true,
      timezone: true,
      inactive: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
