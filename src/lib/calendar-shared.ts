import { toEndOfDayInTimezone } from '@/lib/date-utils';

export type CalendarAssignment = {
  id: string;
  title: string;
  courseId: string;
  dueDate: string | Date;
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
