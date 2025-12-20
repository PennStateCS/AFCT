import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import DashboardClient from '../DashboardClient';

export default async function DashboardPage() {
  const session = await auth();

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
    where: { 
        userId: id,
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
      students: course.roster.filter((r) => r.role === 'STUDENT').map((r) => r.user),
      faculty: course.roster.filter((r) => r.role === 'FACULTY').map((r) => r.user),
      tas: course.roster.filter((r) => r.role === 'TA').map((r) => r.user),
    };
  });

  return (
    <div className="h-full w-full flex-col lg:flex-row">
        <DashboardClient sessionUser={session.user} courses={courses} title={"All Courses"} />
    </div>
  );
}
