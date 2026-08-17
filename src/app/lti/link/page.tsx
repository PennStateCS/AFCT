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

  const select = { id: true, name: true, code: true, semester: true } as const;
  const orderBy = [{ semester: 'desc' as const }, { name: 'asc' as const }];

  // The courses this person runs. For everybody except an administrator this is the whole
  // choice, because the API refuses anything else.
  const own = await prisma.course.findMany({
    where: {
      deletedAt: null,
      roster: { some: { userId: session.user.id, role: 'FACULTY' } },
    },
    select,
    orderBy,
  });

  /**
   * An administrator may link any course, and is shown their own first anyway.
   *
   * The rule is not the question; the default is. Linking is a course action, not a system one,
   * and picking the wrong entry here does not fail safe: the LMS course starts enrolling
   * students into somebody else's course and sending grades to it. An administrator who also
   * teaches was being handed a list of every course in the system with their own buried in it,
   * and the names are not unique, so two sections of the same course read identically.
   *
   * So the safe choice is the one on screen, and the full list is one deliberate click away
   * rather than the default. An administrator who runs no courses gets the full list straight
   * away, since an empty picker would be a wall.
   */
  const all =
    session.user.isAdmin && own.length > 0
      ? await prisma.course.findMany({ where: { deletedAt: null }, select, orderBy })
      : [];
  const courses =
    session.user.isAdmin && own.length === 0
      ? await prisma.course.findMany({ where: { deletedAt: null }, select, orderBy })
      : own;

  return (
    <LinkCourseClient
      pendingId={pending.id}
      contextTitle={pending.contextTitle}
      courses={courses}
      otherCourses={all.filter((course) => !courses.some((mine) => mine.id === course.id))}
    />
  );
}
