import { prisma } from '@/lib/prisma';
import type { EmptyStringNotation } from '@prisma/client';
import { toStudentSafeEnrolled } from '@/lib/course-format';

export type CourseListItem = {
  id: string;
  name: string;
  code: string;
  regCode: string | null;
  semester: string;
  credits: number;
  startDate: Date;
  endDate: Date;
  registrationOpenAt: Date | null;
  registrationCloseAt: Date | null;
  isPublished: boolean;
  isArchived: boolean;
  emptyStringNotation: EmptyStringNotation;
  createdAt: Date;
  updatedAt: Date;
  enrolled?: Array<{
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    avatar?: string | null;
    role?: string;
    courseRole?: string;
    hasSubmissions?: boolean;
  }>;
};

export async function getCoursesListForUser(
  userId: string,
  role: string,
): Promise<CourseListItem[]> {
  const where =
    role === 'ADMIN'
      ? {}
      : {
          roster: { some: { userId } },
          ...(role === 'STUDENT' ? { isPublished: true } : {}),
        };

  const courses = await prisma.course.findMany({
    where,
    select: {
      id: true,
      name: true,
      code: true,
      regCode: true,
      semester: true,
      credits: true,
      startDate: true,
      endDate: true,
      registrationOpenAt: true,
      registrationCloseAt: true,
      isPublished: true,
      isArchived: true,
      emptyStringNotation: true,
      createdAt: true,
      updatedAt: true,
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
    orderBy: { createdAt: 'desc' },
  });

  const viewerIsAdmin = role === 'ADMIN';

  return courses.map((course) => {
    // Decide roster visibility from the viewer's role IN THIS course (they may be
    // faculty in one and a student in another), not the coarse global `role`.
    const viewerEntry = course.roster.find((r) => r.user.id === userId);
    const isStaffHere =
      viewerIsAdmin || viewerEntry?.role === 'FACULTY' || viewerEntry?.role === 'TA';

    const enrolledMembers = course.roster.map((r) => ({ ...r.user, courseRole: r.role }));

    return {
      id: course.id,
      name: course.name,
      code: course.code,
      // The registration code lets someone enroll; only staff/admin need it in a
      // course list. Students (in that course) don't — hide it.
      regCode: isStaffHere ? course.regCode : null,
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
      // Staff see the full roster (names + emails); a student gets staff names only,
      // with classmates collapsed to count-only placeholders and no emails.
      enrolled: isStaffHere ? enrolledMembers : toStudentSafeEnrolled(enrolledMembers),
    };
  });
}
