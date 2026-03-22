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
            {upcoming.map((assignment) => (
              <li key={assignment.id} className="flex flex-col">
                <div>
                  <span aria-hidden="true">📄</span>{' '}
                  <Link
                    href={`/dashboard/courses/${assignment.courseId}/${assignment.id}`}
                    className="text-foreground font-medium hover:underline"
                  >
                    {assignment.title}
                  </Link>
                </div>
                <span className="text-muted-foreground text-sm">
                  {formatDateTimeInTimeZone(assignment.dueDate, timezone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
