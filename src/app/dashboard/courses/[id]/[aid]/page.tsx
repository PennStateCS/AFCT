import type { Metadata } from 'next';
import AssignmentClient from './AssignmentClient';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { AssignmentWithDetails } from '@/lib/assignment-details';
import { resolveStudentContentGate } from '@/lib/assignment-student-gate';

export const metadata: Metadata = {
  title: 'Assignment',
};

type PageProps = {
  params: Promise<{ id: string; aid: string }>;
};

export default async function AssignmentPage({ params }: PageProps) {
  const session = await auth();
  const { id: courseId, aid: assignmentId } = await params;

  if (!session?.user?.id) {
    return <AssignmentClient initialAssignment={null} />;
  }

  let initialAssignment: AssignmentWithDetails | null = null;
  let initialAssignments: { id: string; title: string }[] | undefined = undefined;

  // The viewer's per-course role decides staff vs student treatment; a global
  // admin is always staff.
  const enrollment = await prisma.roster.findFirst({
    where: { courseId, userId: session.user.id },
    select: { id: true, role: true },
  });
  const isStaff =
    Boolean(session.user.isAdmin) || enrollment?.role === 'FACULTY' || enrollment?.role === 'TA';

  if (isStaff) {
    initialAssignments = await prisma.assignment.findMany({
      where: { courseId },
      select: { id: true, title: true },
      orderBy: { title: 'asc' },
    });
  }

  try {
    const assignment = await prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        courseId,
      },
      include: {
        problems: {
          select: {
            maxPoints: true,
            maxSubmissions: true,
            autograderEnabled: true,
            problem: true,
          },
        },
        course: {
          select: {
            id: true,
            name: true,
            code: true,
            isArchived: true,
            timezone: true,
          },
        },
      },
    });

    if (assignment) {
      // Staff (admin or course FACULTY/TA) see any assignment. For a student, being
      // enrolled and the assignment being published is NOT sufficient: they must also be
      // in the assignment's audience, and past their effective unlock time. This payload
      // carries the title, description and problem list, so getting it wrong hands a
      // classmate the contents of work that was deliberately scoped away from them.
      //
      // The same resolver backs the API routes that serve this content, so the page and
      // the API cannot drift. They previously did: the API answered 404 while this page
      // rendered the assignment anyway, which made both "assign to specific students"
      // and "lock until unlockAt" bypassable by opening the URL directly.
      let hasStudentAccess = enrollment?.role === 'STUDENT' && assignment.isPublished;
      if (hasStudentAccess) {
        const gate = await resolveStudentContentGate(assignment.id, session.user.id);
        hasStudentAccess = gate.assigned && !gate.locked;
      }

      if (isStaff || hasStudentAccess) {
        const totalProblemPoints = assignment.problems.reduce((sum, ap) => {
          const value = typeof ap.maxPoints === 'number' ? ap.maxPoints : 0;
          return sum + (Number.isFinite(value) ? value : 0);
        }, 0);

        initialAssignment = {
          ...assignment,
          maxPoints: totalProblemPoints,
          problems: assignment.problems.map((ap) => ({
            problem: ap.problem,
            maxPoints: ap.maxPoints,
            maxSubmissions: ap.maxSubmissions,
            autograderEnabled: ap.autograderEnabled,
          })),
          course: assignment.course,
        };
      }
    }
  } catch {
    initialAssignment = null;
  }

  return (
    <AssignmentClient
      initialAssignment={initialAssignment}
      initialAssignments={initialAssignments}
      isStaff={isStaff}
    />
  );
}
