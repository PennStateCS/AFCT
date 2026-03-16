'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

type PendingAssignment = {
  assignmentId: string;
  assignmentTitle: string;
  courseId: string;
  dueDate: Date;
  pendingCount: number;
};

type SubmissionsModuleProps = {
  pendingAssignments: PendingAssignment[];
};

export function SubmissionsModule({ pendingAssignments }: SubmissionsModuleProps) {
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-lg font-semibold">
          Submissions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {pendingAssignments.length === 0 ? (
          <p className="text-muted-foreground">No submissions need grading.</p>
        ) : (
          <ul className="space-y-3" aria-label="Assignments needing grading">
            {pendingAssignments.map((item) => (
              <li key={item.assignmentId} className="flex flex-col">
                <Link
                  href={`/dashboard/courses/${item.courseId}/${item.assignmentId}`}
                  className="text-foreground font-medium hover:underline"
                >
                  {item.assignmentTitle}
                </Link>
                <span className="text-muted-foreground text-sm">
                  {item.pendingCount} submission{item.pendingCount === 1 ? '' : 's'} need grading
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
