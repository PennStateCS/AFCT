import { prisma } from '@/lib/prisma';

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
              role: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return courses.map((course) => ({
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
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
    enrolled: course.roster.map((r) => ({
      ...r.user,
      role: r.user.role,
      courseRole: r.role,
    })),
  }));
}
