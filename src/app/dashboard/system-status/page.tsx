import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import SystemStatusClient from './SystemStatusClient';
import { WorkspaceSurface } from '@/components/WorkspaceSurface';

export const metadata: Metadata = {
  title: 'System Status',
};

export default async function SystemStatusPage() {
  // Admin-only tooling. Gate the page itself (not just the sidebar link / backing
  // API) so a non-admin can't reach the shell by direct URL; 404 hides its existence.
  const session = await auth();
  if (!session?.user?.isAdmin) {
    notFound();
  }

  // A monitoring workspace, so it sits on the white surface rather than the slate canvas,
  // the same way System Settings and a course do.
  return (
    <WorkspaceSurface>
      <SystemStatusClient />
    </WorkspaceSurface>
  );
}
