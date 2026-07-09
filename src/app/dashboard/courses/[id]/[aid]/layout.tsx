import React from 'react';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { getCourseRole } from '@/lib/permissions';
import AssignmentBreadcrumbSource from '@/components/navbar/AssignmentBreadcrumbSource';

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string; aid: string }>;
};

export default async function AssignmentLayout({ children, params }: Props) {
  const { id, aid } = await params;

  // Only expose the assignment title (via the breadcrumb) to someone who may see
  // this assignment: course staff/admin for any, an enrolled student only once it
  // is published. Without this, a signed-in user who guesses ids could read the
  // title (including unpublished ones) from the breadcrumb even though the page
  // itself blocks the content.
  const session = await auth();
  const viewerIsAdmin = Boolean(session?.user?.isAdmin);
  const viewerRole = await getCourseRole(session?.user?.id, id);
  const canAccess = viewerIsAdmin || viewerRole !== null;
  const isStaff = viewerIsAdmin || viewerRole === 'FACULTY' || viewerRole === 'TA';

  const assignment = canAccess
    ? await prisma.assignment.findFirst({
        where: { id: aid, courseId: id },
        select: { id: true, title: true, isPublished: true },
      })
    : null;
  const visible = assignment && (isStaff || assignment.isPublished);

  return (
    <>
      {visible ? (
        <AssignmentBreadcrumbSource
          assignmentId={assignment.id}
          assignmentTitle={assignment.title}
        />
      ) : null}
      {children}
    </>
  );
}
