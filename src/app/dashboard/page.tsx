import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { prisma } from '@/lib/prisma';
import DashboardClient from './DashboardClient';
import { DueDateModule } from '@/components/modules/DueDateModule';
import { JoinCourseModule } from '@/components/modules/JoinCourseModule';

export default async function DashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return (
      <div className="bg-destructive text-destructive-foreground rounded p-4 text-lg">
        You are not signed in.
      </div>
    );
  }

  const { id } = session.user;

  // Get all courses for the user via roster entries
  const rosterEntries = await prisma.roster.findMany({
    where: { userId: id },
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
  const courses = rosterEntries.map((entry) => ({
    ...entry.course,
    userRole: entry.role, // course-specific role
  }));

  const courseIds = courses.map((c) => c.id);

  // Get upcoming assignments for all user's courses
  const assignments = await prisma.assignment.findMany({
    where: {
      courseId: { in: courseIds },
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
    <div className="flex h-full w-full flex-col lg:flex-row">
      {/* Left (Big Column) */}
      <div className="w-full lg:w-3/4">
        <DashboardClient sessionUser={session.user} courses={courses} />
      </div>

      {/* Right (Skinny Column) */}
      <div className="w-full pt-4 lg:w-1/4 lg:pt-0 lg:pl-4">
        <div className="pb-4">
          <JoinCourseModule />
        </div>
        <div className="pb-4">
          <DueDateModule assignments={assignments} />
        </div>
      </div>
    </div>
  );
}
