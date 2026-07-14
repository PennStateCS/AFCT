'use client';

import React from 'react';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';
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

// Keep the module skimmable: the calendar is the place for the full term.
const MAX_VISIBLE = 5;
const DUE_SOON_MS = 48 * 60 * 60 * 1000;

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

  return (
    <Card className="w-full" aria-labelledby="upcoming-assignments-title">
      <CardHeader>
        <CardTitle
          id="upcoming-assignments-title"
          role="heading"
          aria-level={2}
          className="text-lg font-semibold"
        >
          Upcoming Assignments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {visible.length === 0 ? (
          <p className="text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-3" aria-label="Upcoming assignments list">
            {visible.map((assignment) => {
              const isDraft = assignment.isPublished === false;
              const courseCode = assignment.course?.code;
              const dueSoon =
                new Date(assignment.dueDate).getTime() - now.getTime() <= DUE_SOON_MS;
              return (
                <li key={assignment.id} className="flex flex-col">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <FileText
                      aria-hidden="true"
                      className="text-muted-foreground h-4 w-4 shrink-0"
                    />
                    <Link
                      href={`/dashboard/courses/${assignment.courseId}/${assignment.id}`}
                      className="text-foreground truncate font-medium hover:underline"
                    >
                      {assignment.title}
                    </Link>
                    {isDraft && (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        Draft
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground pl-[1.375rem] text-sm">
                    {courseCode && (
                      <>
                        <span>{courseCode}</span>
                        <span aria-hidden="true"> {'·'} </span>
                      </>
                    )}
                    <span
                      className={cn(
                        dueSoon && 'font-medium text-amber-700 dark:text-amber-400',
                      )}
                    >
                      {formatDateTimeInTimeZone(assignment.dueDate, timezone)}
                      {dueSoon && <span className="sr-only"> (due soon)</span>}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {hiddenCount > 0 && (
          <Link
            href="/dashboard/calendar"
            className="text-muted-foreground hover:text-foreground block text-sm hover:underline"
          >
            {hiddenCount} more on the calendar
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
