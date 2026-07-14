import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import DevelopmentTestsClient from './DevelopmentTestsClient';

export const metadata: Metadata = {
  title: 'Development Tests',
};

export default async function DevelopmentTestsPage() {
  // Developer tooling: admin-only, and never in production. Gate the page itself so a
  // non-admin can't reach the shell by direct URL; 404 hides its existence.
  const session = await auth();
  if (!session?.user?.isAdmin || process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <DevelopmentTestsClient />;
}
