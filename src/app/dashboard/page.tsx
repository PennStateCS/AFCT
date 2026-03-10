import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import DashboardClient from './DashboardClient';
import { DueDateModule } from '@/components/modules/DueDateModule';
import { JoinCourseModule } from '@/components/modules/JoinCourseModule';
import { SubmissionsModule } from '@/components/modules/SubmissionsModule';

export const metadata: Metadata = {
  title: 'AFCT Dashboard',
};

export default async function DashboardPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="bg-destructive text-destructive-foreground rounded p-4 text-lg">
        You are not signed in.
      </div>
    );
  }

  // Get user's id
  const { id, role } = session.user;

  // Get all courses for the user via roster entries
  const rosterEntries = await prisma.roster.findMany({
    where: {
      userId: id,
      course: {
        isArchived: false,
      },
    },
    include: {
      course: {
        include: {
          roster: {
            include: {
              user: true, // Load user info for each roster member
            },
          },
          assignments: true,
        },
      },
    },
  });

  // Map courses and attach the user's role in each
  const courses = rosterEntries.map((entry) => {
    const { course } = entry;

    return {
      ...course,
      userRole: entry.role,
      // Only include enrolled list (user objects with courseRole) — do not construct role-specific arrays
      enrolled: course.roster.map((r) => ({ ...r.user, courseRole: r.role })),
    };
  });

  const courseIds = courses.map((c) => c.id);

  const gradingRoleEntries = rosterEntries.filter(
    (entry) => entry.role === 'TA' || entry.role === 'FACULTY' || entry.role === 'INSTRUCTOR',
  );
  const gradingCourseIds = gradingRoleEntries.map((entry) => entry.courseId);
  const showSubmissions = gradingCourseIds.length > 0;

  const pendingByAssignment = new Map<
    string,
    {
      assignmentId: string;
      assignmentTitle: string;
      courseId: string;
      dueDate: Date;
      pendingCount: number;
    }
  >();

  if (showSubmissions) {
    const manualSubmissions = await prisma.submission.findMany({
      where: {
        assignmentProblem: {
          assignment: {
            courseId: { in: gradingCourseIds },
            course: { isArchived: false },
          },
          autograderEnabled: false,
        },
      },
      select: {
        studentId: true,
        assignmentProblem: {
          select: {
            assignment: {
              select: {
                id: true,
                title: true,
                courseId: true,
                dueDate: true,
              },
            },
            grades: {
              select: {
                studentId: true,
              },
            },
          },
        },
      },
    });

    for (const submission of manualSubmissions) {
      const isGraded = submission.assignmentProblem.grades.some(
        (grade) => grade.studentId === submission.studentId,
      );
      if (isGraded) continue;

      const assignment = submission.assignmentProblem.assignment;
      const key = assignment.id;
      const existing = pendingByAssignment.get(key);

      if (existing) {
        existing.pendingCount += 1;
      } else {
        pendingByAssignment.set(key, {
          assignmentId: assignment.id,
          assignmentTitle: assignment.title,
          courseId: assignment.courseId,
          dueDate: assignment.dueDate,
          pendingCount: 1,
        });
      }
    }
  }

  const pendingAssignments = Array.from(pendingByAssignment.values()).sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
  );

  // Get upcoming assignments for all user's courses
  const assignments = await prisma.assignment.findMany({
    where: {
      courseId: { in: courseIds },
      isPublished: true,
      dueDate: { gt: new Date() },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      courseId: true,
    },
    orderBy: { dueDate: 'asc' },
  });

  return (
    <div className="flex h-full w-full flex-col pb-4 lg:flex-row">
      {/* Left (Big Column) */}
      <div className="w-full lg:w-3/4">
        <DashboardClient sessionUser={session.user} courses={courses} title={'Current Courses'} />
      </div>

      {/* Right (Skinny Column) */}
      <div className="w-full pt-4 lg:w-1/4 lg:pt-0 lg:pl-4">
        <div className="pb-4">
          <JoinCourseModule />
        </div>
        {showSubmissions && (
          <div className="pb-4">
            <SubmissionsModule pendingAssignments={pendingAssignments} />
          </div>
        )}
        <div>
          <DueDateModule assignments={assignments} />
        </div>
      </div>
    </div>
  );
}
