'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';

type DueDateAssignment = {
  id: string;
  title: string;
  dueDate: string | Date;
  courseId: string;
  // `=== false` marks a staff-visible unpublished/draft assignment.
  isPublished?: boolean;
};

type Props = {
  assignments: DueDateAssignment[];
};

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
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground">None</p>
        ) : (
          <ul className="space-y-3" aria-label="Upcoming assignments list">
            {upcoming.map((assignment) => {
              const isDraft = assignment.isPublished === false;
              return (
                <li key={assignment.id} className="flex flex-col">
                  <div>
                    <span aria-hidden="true">📄</span>{' '}
                    <Link
                      href={`/dashboard/courses/${assignment.courseId}/${assignment.id}`}
                      className="text-foreground font-medium hover:underline"
                    >
                      {assignment.title}
                    </Link>
                    {isDraft && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        Draft
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-sm">
                    {formatDateTimeInTimeZone(assignment.dueDate, timezone)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
