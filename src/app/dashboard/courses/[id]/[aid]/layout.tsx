import React from 'react';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { getCourseRole } from '@/lib/permissions';
import AssignmentBreadcrumbSource from '@/components/navbar/AssignmentBreadcrumbSource';
import { resolveStudentContentGate } from '@/lib/assignment-student-gate';

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string; aid: string }>;
};

export default async function AssignmentLayout({ children, params }: Props) {
  const { id, aid } = await params;

  // Only expose the assignment title (via the breadcrumb) to someone who may see this
  // assignment: course staff/admin for any, an enrolled student only once it is
  // published AND it is actually assigned to them. Without this, a signed-in user who
  // guesses ids could read the title from the breadcrumb even though the page itself
  // blocks the content.
  //
  // The assigned check matters as much as the published one: work scoped to specific
  // students (a make-up exam, a differentiated task) must not have its title readable by
  // the rest of the class. The page and the API both gate on this; the breadcrumb is the
  // third surface that renders a title and has to agree with them.
  //
  // Deliberately NOT gated on the unlock time: a student who IS assigned already sees
  // the assignment listed with its opening date. The unlock gate hides the body, not the
  // existence.
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

  let visible = Boolean(assignment) && (isStaff || Boolean(assignment?.isPublished));
  if (visible && !isStaff && session?.user?.id) {
    const gate = await resolveStudentContentGate(aid, session.user.id);
    visible = gate.assigned;
  }

  return (
    <>
      {visible && assignment ? (
        <AssignmentBreadcrumbSource
          assignmentId={assignment.id}
          assignmentTitle={assignment.title}
        />
      ) : null}
      {children}
    </>
  );
}
