import { CourseRole } from '@prisma/client';
import { CourseRoleEnum } from '@/schemas/user';
import type { Row } from '@tanstack/react-table';

export const courseRoleOptions: CourseRole[] = CourseRoleEnum.options as CourseRole[];

// Role ordering used for sorting roster tables by course role.
export const roleOrder: Record<string, number> = {
  FACULTY: 1,
  TA: 2,
  STUDENT: 3,
};

// SortingFn signature: (rowA, rowB, columnId)
export function roleSortingFn<T = unknown>(rowA: Row<T>, rowB: Row<T>, columnId: string): number {
  // Sort by role first
  const aRole = rowA.getValue(columnId) as string;
  const bRole = rowB.getValue(columnId) as string;
  const roleDiff = (roleOrder[aRole] ?? 99) - (roleOrder[bRole] ?? 99);
  if (roleDiff !== 0) return roleDiff;

  // Sort people with the same role by their last name (case insensitive)
  const aLast = (rowA.original as { lastName?: string }).lastName?.toLowerCase?.() ?? '';
  const bLast = (rowB.original as { lastName?: string }).lastName?.toLowerCase?.() ?? '';
  if (aLast < bLast) return -1;
  if (aLast > bLast) return 1;
  return 0;
}

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
