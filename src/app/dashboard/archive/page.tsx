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
        course: {
            isArchived: true,
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

  return (
    <div className="h-full w-full flex-col lg:flex-row">
        <DashboardClient sessionUser={session.user} courses={courses} title={"Archived Courses"} />
    </div>
  );
}
