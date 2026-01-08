import { RoleEnum } from '@/schemas/user';
import type { Role } from '@prisma/client';
import { CourseRole } from '@prisma/client';
import { CourseRoleEnum } from '@/schemas/user';
import type { Row } from '@tanstack/react-table';

// List of valid roles derived from the Zod enum in one place
export const roleOptions: Role[] = RoleEnum.options as Role[];
export const courseRoleOptions: CourseRole[] = CourseRoleEnum.options as CourseRole[]

// Role ordering used for sorting tables
export const roleOrder: Record<string, number> = {
  ADMIN: 1,
  FACULTY: 2,
  INSTRUCTOR: 2,
  TA: 3,
  STUDENT: 4,
};

// SortingFn signature: (rowA, rowB, columnId)
export function roleSortingFn<T = any>(
  rowA: Row<T>,
  rowB: Row<T>,
  columnId: string,
): number {
  // Sort by role first
  const aRole = rowA.getValue(columnId) as string;
  const bRole = rowB.getValue(columnId) as string;
  const roleDiff = (roleOrder[aRole] ?? 99) - (roleOrder[bRole] ?? 99);
  if (roleDiff !== 0) return roleDiff;

  // Sort people with the same role by their last name (case insensitive)
  const aLast = (rowA.original as any).lastName?.toLowerCase?.() ?? '';
  const bLast = (rowB.original as any).lastName?.toLowerCase?.() ?? '';
  if (aLast < bLast) return -1;
  if (aLast > bLast) return 1;
  return 0;
}

// Parse/validate a raw role value and return a Prisma Role or undefined
export function parseRole(raw: unknown): Role | undefined {
  if (typeof raw !== 'string') return undefined;
  if (roleOptions.includes(raw as Role)) return raw as Role;
  return undefined;
}

// Human-friendly formatter for display in UI
export function formatRole(role?: Role | null): string {
  if (!role) return '';
  if (role === 'TA') return 'TA';
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export function isValidRole(raw: unknown): raw is Role {
  return typeof raw === 'string' && roleOptions.includes(raw as Role);
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
