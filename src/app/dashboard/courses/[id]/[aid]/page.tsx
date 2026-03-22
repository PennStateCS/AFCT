import type { Metadata } from 'next';
import AssignmentClient from './AssignmentClient';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AssignmentWithDetails } from '@/lib/assignment-details';

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
          },
        },
      },
    });

    if (assignment) {
      const isStudent = session.user.role === 'STUDENT';
      const enrollment = await prisma.roster.findFirst({
        where: {
          courseId,
          userId: session.user.id,
        },
        select: {
          id: true,
          role: true,
        },
      });

      const hasPrivilegedAccess = session.user.role === 'ADMIN' || !!enrollment;
      const hasStudentAccess =
        isStudent && !!enrollment && enrollment.role === 'STUDENT' && assignment.isPublished;

      if ((isStudent && hasStudentAccess) || (!isStudent && hasPrivilegedAccess)) {
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

  return <AssignmentClient initialAssignment={initialAssignment} />;
}
