'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, ChevronRight, BookOpen } from 'lucide-react';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/lib/date';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { FullCourse } from '@/types/course';

interface StudentAssignmentCardProps {
  course: FullCourse;
}

export function StudentAssignmentCard({ course }: StudentAssignmentCardProps) {
  const router = useRouter();
  const { timezone } = useEffectiveTimezone();
  const limitText = (value: string, max = 140) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;

  const publishedAssignments = course.assignments.filter((assignment) => assignment.isPublished);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">
          <div className="flex items-center gap-2">
            <BookOpen className="h-6 w-6" />
            Assignments
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {course.assignments.length === 0 ? (
          <p className="text-muted-foreground">No assignments available yet.</p>
        ) : (
          <>
            <p className="text-muted-foreground">
              Click on any assignment below to view details and work on problems.
            </p>
            <div className="space-y-4">
              {publishedAssignments.map((assignment) => {
                const dueDate = new Date(assignment.dueDate);
                const isOverdue = dueDate < new Date();
                const allowLateSubmissions = assignment.allowLateSubmissions ?? false;
                const lateCutoffDate = assignment.lateCutoff ? new Date(assignment.lateCutoff) : null;

                return (
                  <div
                    key={assignment.id}
                    className="group flex cursor-pointer overflow-hidden rounded-lg border border-border bg-card shadow transition-all hover:border-primary hover:bg-primary/5 hover:shadow-md"
                    onClick={() => router.push(`/dashboard/courses/${course.id}/${assignment.id}`)}
                  >
                    <div className="bg-primary w-[15px]" />
                    <div className="flex w-full flex-col px-4 py-4 sm:p-5">
                      <div className="mb-2 min-w-0">
                        <CardTitle className="text-md truncate font-semibold" title={assignment.title}>
                          {assignment.title}
                        </CardTitle>
                        {assignment.description ? (
                          <div
                            className="text-muted-foreground mt-1 line-clamp-2 text-sm break-words"
                            title={assignment.description}
                          >
                            {limitText(assignment.description)}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        <div
                          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${
                            isOverdue ? 'border border-red-200 bg-red-100' : 'border border-green-200 bg-green-100'
                          }`}
                        >
                          <span className={`text-sm ${isOverdue ? 'text-red-700' : 'text-green-700'}`}>
                            <Clock className="h-4 w-4" />
                          </span>
                          <span className={`text-sm font-medium ${isOverdue ? 'text-red-700' : 'text-green-700'}`}>
                            {isOverdue ? 'OVERDUE: ' : 'Due: '}
                            {formatDateInTimeZone(dueDate, timezone)} at{' '}
                            {formatTimeInTimeZone(dueDate, timezone)}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                          <div>
                            <span className="font-semibold">Problems:</span> {assignment.problemCount}
                          </div>
                          <div>
                            <span className="font-semibold">Points:</span> {assignment.maxPoints}
                          </div>
                          <div>
                            <span className="font-semibold">Allow Late:</span> {allowLateSubmissions ? 'Yes' : 'No'}
                          </div>
                          {allowLateSubmissions ? (
                            <div>
                              <span className="font-semibold">Late Cutoff:</span>{' '}
                              {lateCutoffDate
                                ? `${formatDateInTimeZone(lateCutoffDate, timezone)} at ${formatTimeInTimeZone(
                                    lateCutoffDate,
                                    timezone,
                                  )}`
                                : 'Never'}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center pr-4 text-slate-400">
                      <ChevronRight className="h-4 w-4" />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
