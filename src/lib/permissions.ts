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

// Course roles at the faculty tier (top of a course; TAs excluded).
export const COURSE_FACULTY_ROLES: CourseRole[] = ['FACULTY'];

// Course roles that count as "staff" (may manage a course). Admins bypass this.
export const COURSE_STAFF_ROLES: CourseRole[] = ['FACULTY', 'TA'];

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
 * May the caller see this course at all? A system admin always may. Otherwise they
 * must be on the roster, AND — for a student — the course must be published; course
 * staff (FACULTY/TA) may access their course even while it is unpublished. This is
 * the single gate for course-scoped reads, so the "students only see published
 * courses" rule lives here rather than being re-checked in every route.
 *
 * One query (role + the course's published flag); admins short-circuit before it.
 */
export async function canAccessCourse(user: PermissionUser, courseId: string): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!user?.id) return false;
  const entry = await prisma.roster.findFirst({
    where: { courseId, userId: user.id },
    select: { role: true, course: { select: { isPublished: true } } },
  });
  if (!entry) return false;
  if (entry.role === 'FACULTY' || entry.role === 'TA') return true;
  // Students (and any non-staff role) only once the course is published.
  return entry.course.isPublished;
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
