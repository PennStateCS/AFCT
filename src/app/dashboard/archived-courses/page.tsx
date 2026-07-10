import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import DashboardClient from '../DashboardClient';
import { toStudentSafeEnrolled } from '@/lib/course-format';

export const metadata: Metadata = {
  title: 'Archived Courses',
};

export default async function ArchivedCoursesPage() {
  const session = await auth();

  if (!session?.user) {
    return (
      <div className="bg-destructive text-destructive-foreground rounded p-4 text-lg">
        You are not signed in.
      </div>
    );
  }

  const { id } = session.user;

  // The caller's archived courses (kept out of the dated sidebar sections).
  const rosterEntries = await prisma.roster.findMany({
    where: {
      userId: id,
      course: {
        isArchived: true,
        deletedAt: null, // a soft-deleted course is archived too — keep it hidden
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

  // Map courses and attach the user's role in each. Students never see an
  // unpublished course they're enrolled in; staff/admin see theirs regardless.
  const viewerIsAdmin = Boolean(session.user.isAdmin);
  const courses = rosterEntries
    .filter(
      (entry) =>
        viewerIsAdmin ||
        entry.role === 'FACULTY' ||
        entry.role === 'TA' ||
        entry.course.isPublished,
    )
    .map((entry) => {
      const { course } = entry;
      // A student must not receive classmate names/emails for an archived course
      // either; staff keep the full roster, students get staff names + count-only.
      const isStaffHere = viewerIsAdmin || entry.role === 'FACULTY' || entry.role === 'TA';
      const enrolledMembers = course.roster.map((r) => ({ ...r.user, courseRole: r.role }));

      return {
        ...course,
        userRole: entry.role,
        enrolled: isStaffHere ? enrolledMembers : toStudentSafeEnrolled(enrolledMembers),
      };
    });

  return (
    <div className="h-full w-full flex-col lg:flex-row">
      <DashboardClient
        sessionUser={{ id, isAdmin: session.user.isAdmin ?? false }}
        courses={courses}
        title={'Archived Courses'}
      />
    </div>
  );
}
