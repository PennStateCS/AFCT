import { prisma } from '@/lib/prisma';
import type { CourseRole } from '@prisma/client';

/**
 * Authorization primitives for the user + admin-flag + per-course-role model.
 *
 * Global authority is a single flag (`isAdmin`); everything else is decided by the
 * caller's role IN a specific course (their `Roster.role`). Route handlers use these
 * helpers instead of inspecting a global role, so the rules live in one tested place.
 */

// The slice of the session user these checks need.
export type PermissionUser = { id?: string | null; isAdmin?: boolean | null } | null | undefined;

// Course roles at the faculty tier (top of a course; TAs excluded). INSTRUCTOR is
// the legacy name for FACULTY and is treated the same until the two are merged.
export const COURSE_FACULTY_ROLES: CourseRole[] = ['INSTRUCTOR', 'FACULTY'];

// Course roles that count as "staff" (may manage a course). Admins bypass this.
export const COURSE_STAFF_ROLES: CourseRole[] = ['INSTRUCTOR', 'FACULTY', 'TA'];

/** Global system administrator — full access everywhere. */
export function isAdmin(user: PermissionUser): boolean {
  return Boolean(user?.isAdmin);
}

/** The caller's role in a specific course, or null if they're not on its roster. */
export async function getCourseRole(
  userId: string | null | undefined,
  courseId: string | null | undefined,
): Promise<CourseRole | null> {
  if (!userId || !courseId) return null;
  const entry = await prisma.roster.findFirst({
    where: { courseId, userId },
    select: { role: true },
  });
  return entry?.role ?? null;
}

/**
 * May the caller see this course at all? Admins always; otherwise they must be
 * enrolled in it (in any role). Use for course-scoped reads students may access.
 */
export async function canAccessCourse(user: PermissionUser, courseId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!user?.id) return false;
  return (await getCourseRole(user.id, courseId)) !== null;
}

/**
 * May the caller perform a staff action in this course? Admins always; otherwise
 * their course role must be one of `roles` (default: FACULTY or TA). Pass a
 * narrower set (e.g. `['FACULTY']`) for actions TAs shouldn't do.
 */
export async function canManageCourse(
  user: PermissionUser,
  courseId: string,
  roles: CourseRole[] = COURSE_STAFF_ROLES,
): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!user?.id) return false;
  const role = await getCourseRole(user.id, courseId);
  return role !== null && roles.includes(role);
}
