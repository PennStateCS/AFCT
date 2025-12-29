// Shared role sorting logic for tables
export const roleOrder: Record<string, number> = {
  ADMIN: 1,
  FACULTY: 2,
  TA: 3,
  STUDENT: 4,
};

// SortingFn signature: (rowA, rowB, columnId)
import type { Row } from '@tanstack/react-table';

export function roleSortingFn<T = any>(
  rowA: Row<T>,
  rowB: Row<T>,
  columnId: string
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