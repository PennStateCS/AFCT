import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import SystemSettingsClient from './SystemSettingsClient';
import { WorkspaceSurface } from '@/components/WorkspaceSurface';

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

  // A work page, so it sits on the white surface rather than the slate canvas, the same
  // way Courses and a course do. The wrapper lives here rather than inside the client
  // component because it bleeds through the layout's gutter; see WorkspaceSurface.
  return (
    <WorkspaceSurface>
      <SystemSettingsClient />
    </WorkspaceSurface>
  );
}
