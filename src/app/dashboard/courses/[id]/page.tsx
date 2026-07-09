import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import CourseClient from './CourseClient';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessCourse } from '@/lib/permissions';

export const metadata: Metadata = {
  title: 'Course',
};

type Props = {
  params: Promise<{ id: string }>;
};

export default async function AdminCoursePage({ params }: Props) {
  const { id } = await params;
  const session = await auth();
  const viewerId = session?.user?.id;
  const viewerIsAdmin = Boolean(session?.user?.isAdmin);

  // Gate the server-side course load behind the same rule the API routes use
  // (canAccessCourse: a system admin, or any enrolled member). Without this, a
  // signed-in non-member who visits /dashboard/courses/<id> would receive the
  // course's roster (names, emails, avatars), registration code, and counts in
  // the SSR payload before any API-route check ran. Checking first also means we
  // never load other users' data for a non-member, and a 404 avoids revealing
  // whether the course exists.
  if (!(await canAccessCourse(session?.user, id))) {
    notFound();
  }

  const course = await prisma.course.findUnique({
    where: { id },
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
              email: true,
              avatar: true,
            },
          },
        },
      },
    },
  });

  if (!course) {
    notFound();
  }

  const viewerRoster = viewerId
    ? (course.roster.find((rosterEntry) => rosterEntry.user.id === viewerId) ?? null)
    : null;

  const initialCourse = {
    id: course.id,
    name: course.name,
    code: course.code,
    regCode: course.regCode,
    semester: course.semester,
    credits: course.credits,
    startDate: course.startDate,
    endDate: course.endDate,
    registrationOpenAt: course.registrationOpenAt,
    registrationCloseAt: course.registrationCloseAt,
    isPublished: course.isPublished,
    isArchived: course.isArchived,
    emptyStringNotation: course.emptyStringNotation,
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    enrolled: course.roster.map((r) => ({ ...r.user, courseRole: r.role, hasSubmissions: false })),
    assignments: [],
    problems: [],
    assignmentTotal: course._count.assignments,
    problemTotal: course._count.problems,
    rosterTotal: course._count.roster,
    viewerRole: viewerRoster?.role ?? null,
    viewerIsAdmin,
  };

  return <CourseClient initialCourse={initialCourse} />;
}
