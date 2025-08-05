'use client';

import Link from 'next/link';
import { format } from 'date-fns';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

type Assignment = {
  id: string;
  title: string; // updated to match schema
  dueDate: string | Date;
  courseId: string;
};

type Props = {
  assignments: Assignment[];
};

export function DueDateModule({ assignments }: Props) {
  const now = new Date();

  const upcoming = assignments
    .filter((a) => new Date(a.dueDate) > now)
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Upcoming Assignments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {upcoming.length === 0 ? (
          <p className="text-muted-foreground">None</p>
        ) : (
          upcoming.map((assignment) => (
            <div key={assignment.id} className="flex flex-col">
              <Link
                href={`/dashboard/courses/${assignment.courseId}/${assignment.id}`}
                className="text-sidebar font-medium hover:underline"
              >
                📄 {assignment.title}
              </Link>
              <span className="text-muted-foreground text-sm">
                {format(new Date(assignment.dueDate), "PPP 'at' p")}
              </span>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
