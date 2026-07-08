import type { Metadata } from 'next';
import CourseClient from './CourseClient';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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
    return <CourseClient initialCourse={null} />;
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
