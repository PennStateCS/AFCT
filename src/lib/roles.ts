import type { CourseRole } from '@prisma/client';

// Sourced from a zod-free module on purpose: this file is reachable from every roster table,
// and taking the list off the zod schema put the whole zod runtime in those bundles.
// See lib/course-roles.
import { courseRoleOptions } from '@/lib/course-roles';

export { courseRoleOptions };

// Role ordering, staff first. Used by `sortRoster` in lib/course-roster, which is where
// roster ordering is decided: the roster table renders the order the server sends rather
// than re-sorting a page of it, so there is deliberately no column sort function here.
export const roleOrder: Record<string, number> = {
  FACULTY: 1,
  TA: 2,
  STUDENT: 3,
};

// --- Course roles (per-course role enum) ---
export function parseCourseRole(raw: unknown): CourseRole | undefined {
  if (typeof raw !== 'string') return undefined;
  if (courseRoleOptions.includes(raw as CourseRole)) return raw as CourseRole;
  return undefined;
}

export function formatCourseRole(role?: CourseRole | null): string {
  if (!role) return '';
  if (role === 'TA') return 'TA';
  return role.charAt(0) + role.slice(1).toLowerCase();
}
