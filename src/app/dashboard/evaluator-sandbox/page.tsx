import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { isCourseStaffAnywhere } from '@/lib/permissions';
import EvaluatorSandboxClient from './EvaluatorSandboxClient';

export const metadata: Metadata = {
  title: 'Evaluator Sandbox',
};

export default async function EvaluatorSandboxPage() {
  // Staff tooling, reachable from both the admin menu and a course page. Gate the page
  // itself (not just the links to it) so a student cannot reach the shell by URL; 404
  // rather than 403, matching the other staff-only pages.
  const session = await auth();
  if (!(await isCourseStaffAnywhere(session?.user))) {
    notFound();
  }

  return <EvaluatorSandboxClient />;
}
