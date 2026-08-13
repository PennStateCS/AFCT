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
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0);

  const startOfGrid = new Date(start);
  startOfGrid.setDate(start.getDate() - start.getDay());

  const endOfGrid = new Date(end);
  endOfGrid.setDate(end.getDate() + (6 - end.getDay()));

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
 * A cell is square, so its height is its width, and the chips inside it are text. Below `sm` a
 * cell is about 36 pixels: room for the date and nothing else, and a chip there truncates to
 * three or four characters, which says less than the dot the cell falls back to. The wider tiers
 * are where a cell is tall enough to stack one, two or three legible lines.
 *
 * A function rather than a chain inside the effect, so the breakpoints can be read and tested in
 * one place. Everything downstream of it is layout, which needs a browser and a person.
 */
export function visibleAssignmentsForWidth(width: number): number {
  if (width < 640) return 0;
  if (width < 768) return 1;
  if (width < 1280) return 2;
  return 3;
}
