'use client';

/* eslint-disable jsx-a11y/no-redundant-roles -- role="list" is not redundant here.
   Tailwind's preflight sets `list-style: none` on every list, and Safari with VoiceOver
   drops list semantics from a list that has no markers, so the explicit role is what puts
   "list, 3 items" back. It also settles axe's aria-prohibited-attr warning, which is that
   naming a bare <ul> has patchy support. Remove the role only if the marker reset goes. */

import React from 'react';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { daysUntilInTimeZone, formatShortDateParts, formatTimeInTimeZone } from '@/lib/date-format';
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
  const { timezone, hour12 } = useEffectiveTimezone();
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
    <Card role="group" className="w-full gap-4 py-5" aria-labelledby="deadlines-title">
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 px-5">
        <CardTitle
          id="deadlines-title"
          role="heading"
          aria-level={2}
          className="text-base font-semibold"
        >
          <span className="flex items-center gap-2.5">
            {/* A bare glyph rather than an icon in a tinted disc; see the Courses card for
                why, and for why it is a size up from the body icons. Decorative: the heading
                beside it already says what this card is. */}
            <CalendarClock
              className="size-5 shrink-0 text-violet-700 dark:text-violet-300"
              aria-hidden="true"
            />
            <span>Deadlines</span>
          </span>
        </CardTitle>
        <Link
          href="/dashboard/calendar"
          className="text-muted-foreground hover:text-foreground shrink-0 text-sm hover:underline"
        >
          View all <span aria-hidden="true">&rarr;</span>
        </Link>
      </CardHeader>
      <CardContent className="px-0">
        {visible.length === 0 ? (
          <p className="text-muted-foreground px-5 text-sm">None</p>
        ) : (
          <ul role="list" aria-label="Deadlines list">
            {visible.map((assignment, index) => {
              const isDraft = assignment.isPublished === false;
              const courseCode = assignment.course?.code;
              // Unchanged: 48 hours is what marks a row urgent, and it is what decides
              // the colour. The wording above it is a separate, calendar-day question.
              const dueSoon = new Date(assignment.dueDate).getTime() - now.getTime() <= DUE_SOON_MS;
              const { month, day } = formatShortDateParts(assignment.dueDate, timezone);

              return (
                // border-t on every row rather than border-b on all but the last, so the
                // list is fenced off from the header the way the Courses module's is.
                <li
                  key={assignment.id}
                  className="border-border flex items-center gap-3 border-t px-5 py-3"
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
                        <span className="bg-status-warning-bg text-status-warning border-status-warning-border shrink-0 rounded border px-1.5 py-0.5 text-xs font-medium">
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
                      <span>{formatTimeInTimeZone(assignment.dueDate, timezone, hour12)}</span>
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
            className="text-muted-foreground hover:text-foreground mt-3 block px-5 text-sm hover:underline"
          >
            {hiddenCount} more on the calendar
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
