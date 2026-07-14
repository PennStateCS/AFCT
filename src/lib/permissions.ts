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

/** Global system administrator: full access everywhere. */
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
 * must be on the roster, AND, for a student, the course must be published; course
 * staff (FACULTY/TA) may access their course even while it is unpublished. This is
 * the single gate for course-scoped reads, so the "students only see published
 * courses" rule lives here rather than being re-checked in every route.
 *
 * One query (role + the course's published flag); admins short-circuit before it.
 */
export async function canAccessCourse(user: PermissionUser, courseId: string): Promise<boolean> {
  if (isAdmin(user)) {
    // A soft-deleted course is inaccessible to everyone, even a system admin.
    // Best-effort: if the lookup errors, fall through and allow, so a transient DB
    // fault surfaces from the handler rather than masking as a denial.
    try {
      if (await isCourseDeleted(courseId)) return false;
    } catch {
      /* fall through */
    }
    return true;
  }
  if (!user?.id) return false;
  const entry = await prisma.roster.findFirst({
    where: { courseId, userId: user.id },
    select: { role: true, course: { select: { isPublished: true, deletedAt: true } } },
  });
  if (!entry) return false;
  // A soft-deleted course is inaccessible to non-admins (retained only for recovery).
  if (entry.course?.deletedAt) return false;
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
  if (isAdmin(user)) {
    // A soft-deleted course can't be managed by anyone, even a system admin.
    try {
      if (await isCourseDeleted(courseId)) return false;
    } catch {
      /* fall through */
    }
    return true;
  }
  if (!user?.id) return false;
  const entry = await prisma.roster.findFirst({
    where: { courseId, userId: user.id },
    select: { role: true, course: { select: { deletedAt: true } } },
  });
  if (!entry) return false;
  // A soft-deleted course can't be managed by non-admins (retained only for recovery).
  if (entry.course?.deletedAt) return false;
  return roles.includes(entry.role);
}

/** Is this course archived? A `null`/missing course reads as not archived. */
export async function isCourseArchived(courseId: string): Promise<boolean> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { isArchived: true },
  });
  return Boolean(course?.isArchived);
}

/**
 * Is this course soft-deleted? Used to keep deleted courses inaccessible to everyone
 * (admins included). A `null`/missing course reads as not deleted, so the handler
 * still runs and returns its own 404.
 */
export async function isCourseDeleted(courseId: string): Promise<boolean> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { deletedAt: true },
  });
  return Boolean(course?.deletedAt);
}

/**
 * Does the caller have scoped account authority over `targetUserId`? True when the
 * caller is a system admin, or is **course staff (FACULTY/TA) of any course in which
 * the target is enrolled as a STUDENT**. This is the gate for a faculty/TA acting on
 * a student's account (e.g. resetting their password): being a STUDENT in one of the
 * caller's courses is sufficient; the target's roles in *other* courses don't matter.
 */
export async function staffManagesStudent(
  caller: PermissionUser,
  targetUserId: string,
): Promise<boolean> {
  if (isAdmin(caller)) return true;
  if (!caller?.id || !targetUserId) return false;
  // A student-roster row for the target whose course also rosters the caller as staff.
  const rel = await prisma.roster.findFirst({
    where: {
      userId: targetUserId,
      role: 'STUDENT',
      course: {
        roster: { some: { userId: caller.id, role: { in: COURSE_STAFF_ROLES } } },
      },
    },
    select: { id: true },
  });
  return rel !== null;
}

/** Do two users share at least one group in the same course? */
export async function usersShareGroupInCourse(
  courseId: string,
  userA: string | null | undefined,
  userB: string | null | undefined,
): Promise<boolean> {
  if (!courseId || !userA || !userB) return false;
  if (userA === userB) return true;
  const shared = await prisma.groupRoster.findFirst({
    where: {
      courseId,
      userId: userA,
      group: { groupRosters: { some: { userId: userB } } },
    },
    select: { id: true },
  });
  return shared !== null;
}

/**
 * May the caller view `targetStudentId`'s course-scoped data (submissions, grades,
 * review data, files)? Admins and course staff may view anyone's; a student may view
 * **their own**. On a **group** assignment (`opts.groupAssignment`), the group is the
 * unit, so a student may also view a **groupmate's** shared work. Never crosses into
 * another student/group.
 *
 * Course membership itself is assumed already gated (e.g. by `withCourseAuth`); this
 * decides *whose* data within the course the caller may see.
 */
export async function canViewStudentData(
  user: PermissionUser,
  courseId: string,
  targetStudentId: string,
  opts?: { groupAssignment?: boolean },
): Promise<boolean> {
  if (isAdmin(user)) return true;
  if (!user?.id) return false;
  if (user.id === targetStudentId) return true;
  if (await canManageCourse(user, courseId)) return true;
  if (opts?.groupAssignment) {
    return usersShareGroupInCourse(courseId, user.id, targetStudentId);
  }
  return false;
}
