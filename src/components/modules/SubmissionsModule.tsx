'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useState } from 'react';

type PendingAssignment = {
  assignmentId: string;
  assignmentTitle: string;
  courseId: string;
  dueDate: Date;
  pendingCount: number;
  processingCount: number;
  gradedCount: number;
  failedCount: number;
};

type SubmissionsModuleProps = {
  assignments: PendingAssignment[];
};

export function SubmissionsModule({ assignments }: SubmissionsModuleProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Function to handle a rerun 
  async function handleRerun(assignments: PendingAssignment[]) {
    setIsSubmitting(true);
    const processedCourses = new Set<string>();

    try {
      for (const item of assignments) {
        if (!processedCourses.has(item.courseId)) {
          processedCourses.add(item.courseId);
          
          // Trigger the API request for the course
          await fetch(`/api/course_submissions/${item.courseId}`, {
            method: 'POST',
          });
        }
      }
    } catch (error) {
      console.error("Failed to rerun submissions:", error);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="text-lg font-semibold">
          Submissions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {assignments.length === 0 ? (
          <p className="text-muted-foreground">No submissions need grading.</p>
        ) : (
          <div>
            <ul className="space-y-3" aria-label="Assignments needing grading">
              {assignments.map((item) => (
                <li key={item.assignmentId} className="flex flex-col">
                  <Link
                    href={`/dashboard/courses/${item.courseId}/${item.assignmentId}`}
                    className="text-foreground font-medium hover:underline"
                  >
                    {item.assignmentTitle}
                  </Link>
                  <span className="text-muted-foreground text-sm">
                    {item.pendingCount} PENDING • {item.processingCount} PROCESSING • {item.gradedCount} GRADED • {item.failedCount} FAILED
                  </span>
                </li>
              ))}
            </ul>
            <Button
              onClick={() => handleRerun(assignments)}
              disabled={isSubmitting}
              className="mt-4"
            >
              {isSubmitting ? 'Rerunning...' : 'Rerun Failed Submissions'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
