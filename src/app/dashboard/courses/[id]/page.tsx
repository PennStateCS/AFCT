import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CourseClient from './CourseClient';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getCourseRole } from '@/lib/permissions';
import { toStudentSafeEnrolled } from '@/lib/course-format';

export const metadata: Metadata = {
  title: 'Course',
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AdminCoursePage({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  const viewerIsAdmin = Boolean(session?.user?.isAdmin);

  // Resolve the viewer's role first, then gate the load on it (a system admin or
  // any enrolled member). Without this a signed-in non-member who visits
  // /dashboard/courses/<id> would receive the course's roster (names, emails,
  // avatars), registration code, and counts in the SSR payload before any
  // API-route check ran; a 404 also avoids revealing whether the course exists.
  const viewerRole = await getCourseRole(session?.user?.id, id);
  if (!viewerIsAdmin && viewerRole === null) {
    notFound();
  }
  // Only course staff (FACULTY/TA or admin) may see the full roster, including
  // classmate emails. For a student, we don't even query peers' emails, and the
  // roster is reduced to staff names + count-only placeholders below.
  const isStaff = viewerIsAdmin || viewerRole === 'FACULTY' || viewerRole === 'TA';

  const course = await prisma.course.findFirst({
    // Exclude soft-deleted courses; they're hidden from the dashboard for everyone
    // (recovery is out-of-band), so a deleted course 404s here like a missing one.
    where: { id, deletedAt: null },
    include: {
      _count: {
        select: {
          assignments: true,
          problems: true,
          roster: true,
        },
      },
      roster: {
        select: {
          role: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              cropX: true,
              cropY: true,
              zoom: true,
              // Emails are only for staff; never queried for a student viewer.
              email: isStaff,
            },
          },
        },
      },
    },
  });

  if (!course) {
    notFound();
  }

  // A student may only open a PUBLISHED course; staff/admin may open theirs while
  // unpublished. 404-mask an unpublished course from a student (matches the API's
  // canAccessCourse rule and keeps its existence hidden).
  if (!isStaff && !course.isPublished) {
    notFound();
  }

  const enrolledMembers = course.roster.map((r) => ({ ...r.user, courseRole: r.role }));
  const enrolled = isStaff
    ? enrolledMembers.map((member) => ({ ...member, hasSubmissions: false }))
    : toStudentSafeEnrolled(enrolledMembers);

  const initialCourse = {
    id: course.id,
    name: course.name,
    code: course.code,
    // Registration/join code is staff-only; never send it to a student's client.
    regCode: isStaff ? course.regCode : null,
    semester: course.semester,
    credits: course.credits,
    startDate: course.startDate,
    endDate: course.endDate,
    registrationOpenAt: course.registrationOpenAt,
    registrationCloseAt: course.registrationCloseAt,
    isPublished: course.isPublished,
    isArchived: course.isArchived,
    deletedAt: course.deletedAt, // always null here: deleted courses are filtered out
    timezone: course.timezone,
    emptyStringNotation: course.emptyStringNotation,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    enrolled,
    assignments: [],
    problems: [],
    assignmentTotal: course._count.assignments,
    problemTotal: course._count.problems,
    rosterTotal: course._count.roster,
    viewerRole,
    viewerIsAdmin,
  };

  return <CourseClient initialCourse={initialCourse} />;
}
