import { prisma } from '@/lib/prisma';

/**
 * Returns all published courses for a given user.
 * Includes courses where the user is a student, TA, or faculty member.
 */
export async function getPublishedCoursesForUser(userId: string) {
  return prisma.course.findMany({
    where: {
      isPublished: true,
      roster: {
        some: {
          userId: userId,
        },
      },
    },
    select: {
      id: true,
      name: true,
      code: true,
      semester: true,
      credits: true,
      startDate: true,
      endDate: true,
      isPublished: true,
    },
    orderBy: {
      name: 'asc',
    },
  });
}

/**
 * Returns a specific published course if the user is enrolled.
 */
export async function getPublishedCourseById(userId: string, courseId: string) {
  return prisma.course.findFirst({
    where: {
      id: courseId,
      isPublished: true,
      roster: {
        some: {
          userId: userId,
        },
      },
    },
    include: {
      assignments: {
        where: { isPublished: true },
        include: {
          problems: true,
        },
      },
    },
  });
}
