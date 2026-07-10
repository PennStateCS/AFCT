import { prisma } from '@/lib/prisma';
import { DEFAULT_TIMEZONE } from '@/lib/user-timezone';

/**
 * Resolves the canonical timezone that anchors a course's deadlines: the course's own
 * `timezone`, then the system default, then {@link DEFAULT_TIMEZONE}. Staff-entered
 * wall-times (due dates, late cutoffs) are interpreted in this zone — **not** the
 * actor's — so a deadline is one fixed instant for every student regardless of who
 * saved it or where they are.
 */
export async function resolveCourseTimezone(courseId?: string | null): Promise<string> {
  if (courseId) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { timezone: true },
    });
    if (course?.timezone) return course.timezone;
  }

  const system = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return system?.timezone || DEFAULT_TIMEZONE;
}

/**
 * The system default timezone used when creating a course without an explicit zone.
 * (System setting, then the built-in default.)
 */
export async function resolveSystemTimezone(): Promise<string> {
  const system = await prisma.systemSettings.findUnique({ where: { id: 1 } });
  return system?.timezone || DEFAULT_TIMEZONE;
}
