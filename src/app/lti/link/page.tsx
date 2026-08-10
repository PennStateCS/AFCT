import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import LinkCourseClient from './LinkCourseClient';

export const metadata: Metadata = {
  title: 'Set up this course',
};

/**
 * The first launch from an LMS course nobody has linked yet.
 *
 * Two audiences. Faculty and admins get a picker. Everyone else gets told it is not ready,
 * because a student cannot fix this and should not be asked to.
 *
 * The choices are read here rather than fetched, so the page is right on first paint and the
 * list can never include a course the person does not run.
 */
export default async function LinkLaunchPage({
  searchParams,
}: {
  searchParams: Promise<{ pending?: string; notReady?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { pending: pendingId } = await searchParams;

  const pending = pendingId
    ? await prisma.ltiPendingLink.findFirst({
        where: { id: pendingId, userId: session.user.id, expiresAt: { gt: new Date() } },
        select: { id: true, contextTitle: true },
      })
    : null;

  if (!pending) {
    return <LinkCourseClient notReady />;
  }

  // Only courses this person actually runs. An admin may link any, matching the rule the API
  // enforces; anything else would offer a choice the API then refuses.
  const courses = session.user.isAdmin
    ? await prisma.course.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, code: true, semester: true },
        orderBy: [{ semester: 'desc' }, { name: 'asc' }],
      })
    : await prisma.course.findMany({
        where: {
          deletedAt: null,
          roster: { some: { userId: session.user.id, role: 'FACULTY' } },
        },
        select: { id: true, name: true, code: true, semester: true },
        orderBy: [{ semester: 'desc' }, { name: 'asc' }],
      });

  return (
    <LinkCourseClient
      pendingId={pending.id}
      contextTitle={pending.contextTitle}
      courses={courses}
    />
  );
}
