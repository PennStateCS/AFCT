import type { Metadata } from 'next';
import UsersClient from './UsersClient';
import { auth } from '@/lib/auth';
import { getUsersList } from '@/lib/users-list';

export const metadata: Metadata = {
  title: 'User Accounts',
};

export default async function UsersPage() {
  const session = await auth();
  const canViewUsers = !!session?.user && ['ADMIN', 'FACULTY', 'TA'].includes(session.user.role);

  const initialUsers = canViewUsers ? await getUsersList() : [];

  return <UsersClient initialUsers={initialUsers} />;
}
