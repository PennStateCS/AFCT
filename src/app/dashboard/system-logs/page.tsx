import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import SystemLogsClient from './SystemLogsClient';

export const metadata: Metadata = {
  title: 'System Logs',
};

export default async function SystemLogsPage() {
  // The full system log view is admin-only. Gate the page itself so a non-admin can't
  // reach the shell by direct URL; 404 hides its existence.
  const session = await auth();
  if (!session?.user?.isAdmin) {
    notFound();
  }

  return <SystemLogsClient />;
}
