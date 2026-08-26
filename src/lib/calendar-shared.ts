import { toEndOfDayInTimezone } from '@/lib/date-convert';

export type CalendarAssignment = {
  id: string;
  title: string;
  courseId: string;
  dueDate: string | Date;
  // Only ever `false` for a staff/admin viewer (students receive published-only).
  // Absent is treated as published; `=== false` means an unpublished/draft entry.
  isPublished?: boolean;
  course: {
    id: string;
    code: string;
    name: string;
  };
  crossedOut?: boolean;
  studentHasSubmission?: boolean;
  studentHasGrade?: boolean;
  totalStudents?: number;
  gradedCount?: number;
  allGraded?: boolean;
};

export function getDateKeyInTimeZone(date: Date | string, timeZone: string): string {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${lookup.year ?? '0000'}-${lookup.month ?? '01'}-${lookup.day ?? '01'}`;
}

export function getMonthRangeIso(
  month: Date,
  timezone: string,
): { startIso: string; endIso: string } {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);

  const startOfGrid = new Date(start);
  startOfGrid.setDate(start.getDate() - start.getDay());

  // Always six weeks, matching the grid's `fixedWeeks`. A February that starts on a
  // Sunday fills in four rows and pads out to six, so the natural "last day of the
  // month, rounded up to Saturday" end would leave up to two rendered weeks outside the
  // fetched range: real assignments in cells that silently showed nothing. Six weeks is
  // a superset of the old range for every month, so this only ever fetches more.
  const endOfGrid = new Date(startOfGrid);
  endOfGrid.setDate(startOfGrid.getDate() + 41);

  const startKey = getDateKeyInTimeZone(startOfGrid, timezone);
  const endKey = getDateKeyInTimeZone(endOfGrid, timezone);

  return {
    startIso: toEndOfDayInTimezone(`${startKey}T00:00`, timezone).toISOString(),
    endIso: toEndOfDayInTimezone(`${endKey}T23:59`, timezone).toISOString(),
  };
}

/**
 * How many assignments a day cell can usefully show at a given viewport width.
 *
 * Cells used to be square, so height followed width and the tiers here tracked how tall a cell
 * happened to be. They now carry an explicit min-height per breakpoint (see CalendarClient), so
 * these tiers mirror those heights instead: roughly 56px on a phone, 80px from `sm`, and 96px
 * or more from `md`. A cell has about 28px of chrome (the date row and its padding) and each
 * chip costs about 22px with its gap, which is where the counts come from.
 *
 * Below `sm` the answer is still zero: a phone cell is about 45px wide, so a chip truncates to
 * three or four characters, which says less than the marker the cell falls back to.
 *
 * A function rather than a chain inside the effect, so the breakpoints can be read and tested in
 * one place. Everything downstream of it is layout, which needs a browser and a person.
 */
export function visibleAssignmentsForWidth(width: number): number {
  if (width < 640) return 0;
  if (width < 768) return 2;
  return 3;
}
