import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import DashboardClient from './DashboardClient';
import { DueDateModule } from '@/components/modules/DueDateModule';
import { JoinCourseModule } from '@/components/modules/JoinCourseModule';
import { toStudentSafeEnrolled } from '@/lib/course-format';
import { getCourseDateBucket } from '@/lib/course-status';

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
        // Never surface archived or soft-deleted courses on the dashboard (archiving
        // or deleting a course does not flip isPublished, so students could otherwise
        // still see a published-then-archived course and its upcoming assignments).
        isArchived: false,
        deletedAt: null,
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
                },
              },
            },
          },
        },
      },
    },
  });

  // Map courses and attach the user's role in each. A student must not even see an
  // unpublished course they're enrolled in (e.g. a faculty pre-enroll before
  // release); staff/admin see theirs regardless of publish state.
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
      // The viewer's role in THIS course decides roster visibility: staff see the
      // members; a student must not receive classmate names, so their roster is
      // reduced to staff names + count-only placeholders (the cards only show
      // instructor/TA names and a staff-gated student count).
      const isStaffHere = viewerIsAdmin || entry.role === 'FACULTY' || entry.role === 'TA';
      const enrolledMembers = course.roster.map((r) => ({ ...r.user, courseRole: r.role }));

      return {
        ...course,
        userRole: entry.role,
        enrolled: isStaffHere ? enrolledMembers : toStudentSafeEnrolled(enrolledMembers),
      };
    });

  const courseIds = courses.map((c) => c.id);

  // The dashboard cards show only in-progress courses, matching the sidebar's
  // "Current Courses" bucket. Upcoming courses live in the sidebar's Upcoming
  // section; they still feed the (cross-course) Upcoming Assignments list above.
  const currentCourses = courses.filter((c) => getCourseDateBucket(c) === 'current');

  // NOTE: the "pending grading" module was removed. Its map was never populated
  // (nothing ever inserted a first entry), so it always rendered empty while still
  // running two unbounded submission/grade queries on this (the most-visited)
  // page. The feature can be rebuilt properly later; until then it does no work.

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
            // The module labels each row with its course so multi-course users can
            // tell which "Lab 3" is which.
            course: { select: { code: true } },
          },
          orderBy: { dueDate: 'asc' },
        });

  return (
    <div className="flex h-full w-full flex-col pb-4 lg:flex-row">
      <h1 className="sr-only">Dashboard</h1>
      {/* Left (Big Column) */}
      <div className="w-full lg:w-3/4">
        <DashboardClient
          sessionUser={{ id, isAdmin: session.user.isAdmin ?? false }}
          courses={currentCourses}
          title={'Current Courses'}
        />
      </div>

      {/* Right (Skinny Column) */}
      <div className="w-full pt-4 lg:w-1/4 lg:pt-0 lg:pl-4">
        <div className="pb-4">
          <JoinCourseModule />
        </div>
        <div>
          <DueDateModule assignments={assignments} />
        </div>
      </div>
    </div>
  );
}
