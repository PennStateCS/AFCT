/**
 * The canonical severity and category values for `ActivityLog`, in the order they should
 * be offered in a filter menu.
 *
 * These lists were duplicated in the admin logs route, the System Logs client and a schema
 * comment, and the course Activity tab was about to make a fourth copy. A filter that
 * drifts from the values actually written is a filter that silently hides rows, so there
 * is one list.
 *
 * `category` is a plain String column (not an enum), so these are a convention rather than
 * a database constraint: treat them as the values a filter may offer, and never as a
 * guarantee that nothing else is stored.
 */
export const LOG_SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'SECURITY'] as const;

export const LOG_CATEGORIES = [
  'SYSTEM',
  'USER',
  'COURSE',
  'ASSIGNMENT',
  'PROBLEM',
  'SUBMISSION',
  'GRADE',
] as const;

export type LogSeverityValue = (typeof LOG_SEVERITIES)[number];
export type LogCategoryValue = (typeof LOG_CATEGORIES)[number];

/**
 * Keep only the known values from repeated query params, in canonical order. An unknown
 * token narrows nothing rather than reaching Prisma.
 */
export function pickLogValues<T extends readonly string[]>(raw: string[], allowed: T): T[number][] {
  const wanted = new Set(raw.map((v) => v.trim().toUpperCase()));
  return allowed.filter((a) => wanted.has(a));
}

/**
 * The column ids the course Activity feed can be ordered by, server-side.
 *
 * These must be the ids the table's columns actually carry. TanStack derives a column's id
 * from its `accessorKey` by replacing dots with underscores, so `accessorKey: 'user.lastName'`
 * yields `user_lastName`, not `user.lastName`. Getting that wrong is silent: the header
 * shows a sort indicator while the server quietly falls back to its default order.
 * `activity-columns.test.tsx` asserts the columns' sortable ids match this list exactly.
 */
export const ACTIVITY_SORT_KEYS = [
  'timestamp',
  'action',
  'category',
  'ipAddress',
  'userFirstName',
  'userLastName',
] as const;
