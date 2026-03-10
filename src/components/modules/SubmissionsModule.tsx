'use client';

import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="text-lg font-semibold">Submissions</CardTitle>
        <Badge variant="outline" className="bg-blue-50 text-blue-700">
          Beta Feature
        </Badge>
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
