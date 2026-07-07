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
  const { id } = session.user;

  // Get all courses for the user via roster entries
  const rosterEntries = await prisma.roster.findMany({
    where: {
      userId: id,
      course: {
        endDate: {
          gte: new Date(),
        },
      },
    },
    select: {
      role: true,
      courseId: true,
      course: {
        select: {
          id: true,
          name: true,
          code: true,
          semester: true,
          credits: true,
          startDate: true,
          endDate: true,
          isPublished: true,
          isArchived: true,
          roster: {
            select: {
              role: true,
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  role: true,
                },
              },
            },
          },
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
    (entry) => entry.role === 'TA' || entry.role === 'FACULTY',
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
      processingCount: number;
      gradedCount: number;
      failedCount: number;
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
        assignmentId: true,
        problemId: true,
        studentId: true,
        status: true,
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
          },
        },
      },
    });

    const manualGrades = await prisma.assignmentProblemGrade.findMany({
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
        assignmentId: true,
        problemId: true,
        studentId: true,
      },
    });

    const gradedSubmissionKeys = new Set(
      manualGrades.map((grade) => `${grade.assignmentId}:${grade.problemId}:${grade.studentId}`),
    );

    for (const submission of manualSubmissions) {
      const isGraded = gradedSubmissionKeys.has(
        `${submission.assignmentId}:${submission.problemId}:${submission.studentId}`,
      );

      const assignment = submission.assignmentProblem.assignment;
      const key = assignment.id;
      const existing = pendingByAssignment.get(key);

      if (existing) {
        if (isGraded) {
          existing.gradedCount += 1;
          continue;
        }

        if (submission.status == 'FAILED') {
          existing.failedCount += 1;
          continue;
        }

        if (submission.status == 'PROCESSING') {
          existing.processingCount += 1;
          continue;
        }

        existing.pendingCount += 1;
      }
    }
  }

  const pendingAssignments = Array.from(pendingByAssignment.values()).sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime(),
  );

  // Get upcoming assignments for all user's courses
  const assignments =
    courseIds.length === 0
      ? []
      : await prisma.assignment.findMany({
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
      <h1 className="sr-only">Dashboard</h1>
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
            <SubmissionsModule assignments={pendingAssignments} />
          </div>
        )}
        <div>
          <DueDateModule assignments={assignments} />
        </div>
      </div>
    </div>
  );
}
