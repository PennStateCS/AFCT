import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import DashboardClient from '../DashboardClient';

export const metadata: Metadata = {
  title: 'Previous Courses',
};

export default async function AllCoursesPage() {
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
        endDate: {
          lt: new Date(),
        },
      },
    },
    select: {
      role: true,
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
                  email: true,
                  avatar: true,
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

  return (
    <div className="h-full w-full flex-col lg:flex-row">
      <DashboardClient
        sessionUser={{ id, isAdmin: session.user.isAdmin ?? false }}
        courses={courses}
        title={'Previous Courses'}
      />
    </div>
  );
}
