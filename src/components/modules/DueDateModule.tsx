'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import {
  daysUntilInTimeZone,
  formatShortDateParts,
  formatTimeInTimeZone,
} from '@/lib/date-format';
import { cn } from '@/lib/utils';

type DueDateAssignment = {
  id: string;
  title: string;
  dueDate: string | Date;
  courseId: string;
  // `=== false` marks a staff-visible unpublished/draft assignment.
  isPublished?: boolean;
  // Present when the feed joins the course (calendar always does; dashboard now does).
  course?: { code?: string | null } | null;
};

type Props = {
  assignments: DueDateAssignment[];
};

/**
 * Date-tile tints, applied by position so five stacked tiles are easy to tell apart at a
 * glance. Decorative only: AFCT's status tokens carry meaning, and cycling them by row
 * index would claim row 0 is a danger and row 3 is information, which is not true. What
 * a row means is said by its urgency label, which these deliberately do not touch.
 *
 * Every pair clears AA on its own tint in both themes (4.8:1 at worst, on amber).
 */
const TILE_TINTS = [
  'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  'border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300',
  'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
] as const;

// Keep the module skimmable: the calendar is the place for the full term.
const MAX_VISIBLE = 5;
const DUE_SOON_MS = 48 * 60 * 60 * 1000;

/**
 * The right-hand label. Calendar days rather than elapsed hours, so something due at 1am
 * tomorrow reads "Tomorrow" and not "Due today". Anything further out falls back to the
 * date itself, which is what the reader would have to work out anyway.
 */
function dueLabel(dueDate: string | Date, timezone: string): string {
  const days = daysUntilInTimeZone(dueDate, timezone);
  const { month, day } = formatShortDateParts(dueDate, timezone);
  if (days === null) return `${month} ${day}`.trim();
  if (days <= 0) return 'Due today';
  if (days === 1) return 'Tomorrow';
  if (days <= 6) return `In ${days} days`;
  return `${month} ${day}`.trim();
}

export function DueDateModule({ assignments }: Props) {
  const { timezone } = useEffectiveTimezone();
  const now = new Date();

  const upcoming = assignments
    .filter((a) => new Date(a.dueDate) > now)
    .sort((a, b) => {
      const aTime = new Date(a.dueDate).getTime();
      const bTime = new Date(b.dueDate).getTime();
      if (isNaN(aTime) && isNaN(bTime)) return 0;
      if (isNaN(aTime)) return 1;
      if (isNaN(bTime)) return -1;
      return aTime - bTime;
    });

  const visible = upcoming.slice(0, MAX_VISIBLE);
  const hiddenCount = upcoming.length - visible.length;

  // Compact shell: the shared Card's py-6/gap-6 is right for a full-width module and
  // too airy for a narrow rail one. A local override, not a change to the primitive.
  return (
    <Card className="w-full gap-4 py-5" aria-labelledby="deadlines-title">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 px-5">
        <CardTitle
          id="deadlines-title"
          role="heading"
          aria-level={2}
          className="text-base font-semibold"
        >
          Deadlines
        </CardTitle>
        <Link
          href="/dashboard/calendar"
          className="text-muted-foreground hover:text-foreground shrink-0 text-sm hover:underline"
        >
          View all <span aria-hidden="true">&rarr;</span>
        </Link>
      </CardHeader>
      <CardContent className="px-5">
        {visible.length === 0 ? (
          <p className="text-muted-foreground text-sm">None</p>
        ) : (
          <ul aria-label="Deadlines list">
            {visible.map((assignment, index) => {
              const isDraft = assignment.isPublished === false;
              const courseCode = assignment.course?.code;
              // Unchanged: 48 hours is what marks a row urgent, and it is what decides
              // the colour. The wording above it is a separate, calendar-day question.
              const dueSoon =
                new Date(assignment.dueDate).getTime() - now.getTime() <= DUE_SOON_MS;
              const { month, day } = formatShortDateParts(assignment.dueDate, timezone);

              return (
                <li
                  key={assignment.id}
                  className={cn(
                    'flex items-center gap-3 py-3',
                    index < visible.length - 1 && 'border-border border-b',
                  )}
                >
                  {/* aria-hidden: the same date is already in the row's text, and the
                      tint says nothing a reader needs. Month and day inherit the tile's
                      colour; their hierarchy is size and weight, as before. */}
                  <div
                    aria-hidden="true"
                    className={cn(
                      'flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-md border',
                      TILE_TINTS[index % TILE_TINTS.length],
                    )}
                  >
                    <span className="text-2xs leading-none font-medium uppercase">{month}</span>
                    <span className="text-base leading-tight font-semibold">{day}</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Link
                        href={`/dashboard/courses/${assignment.courseId}/${assignment.id}`}
                        className="text-foreground truncate text-sm font-medium hover:underline"
                      >
                        {assignment.title}
                      </Link>
                      {isDraft && (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                          Draft
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground truncate text-sm">
                      {courseCode && (
                        <>
                          <span>{courseCode}</span>
                          <span aria-hidden="true"> {'·'} </span>
                        </>
                      )}
                      <span>{formatTimeInTimeZone(assignment.dueDate, timezone)}</span>
                    </div>
                  </div>

                  {/* Text, not just colour: "Due today" says it on its own for anyone who
                      cannot see the warning tint. */}
                  <span
                    className={cn(
                      'shrink-0 text-sm',
                      dueSoon ? 'text-status-warning font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {dueLabel(assignment.dueDate, timezone)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {hiddenCount > 0 && (
          <Link
            href="/dashboard/calendar"
            className="text-muted-foreground hover:text-foreground mt-3 block text-sm hover:underline"
          >
            {hiddenCount} more on the calendar
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
