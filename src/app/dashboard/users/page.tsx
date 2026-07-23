import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import UsersClient from './UsersClient';
import { auth } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'User Accounts',
};

export default async function UsersPage() {
  const session = await auth();
  // Admin-only page: hide its existence from everyone else (404), matching the
  // other admin pages (system settings/status/logs) rather than rendering an
  // empty shell. The backing /api/admin/users route is the authoritative gate.
  if (!session?.user?.isAdmin) {
    notFound();
  }

  // The table paginates server-side (like System Logs), so it fetches its own first
  // page client-side rather than being seeded with the full list here.
  return <UsersClient />;
}
