import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import SystemSettingsClient from './SystemSettingsClient';

export const metadata: Metadata = {
  title: 'System Settings',
};

export default async function SystemSettingsPage() {
  // Admin-only tooling. Gate the page itself (not just the sidebar link / backing
  // API) so a non-admin can't reach the shell by direct URL; 404 hides its existence.
  const session = await auth();
  if (!session?.user?.isAdmin) {
    notFound();
  }

  return <SystemSettingsClient />;
}
