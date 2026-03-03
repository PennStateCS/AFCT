'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FullCourse } from '@/types/course';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/lib/date';

interface StudentCourseViewProps {
  course: FullCourse;
}

export function StudentCourseView({ course }: StudentCourseViewProps) {
  const router = useRouter();
  const { timezone } = useEffectiveTimezone();
  const limitText = (value: string, max = 140) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">📄 Assignments</CardTitle>
      </CardHeader>
      <CardContent>
        {course.assignments.length === 0 ? (
          <p className="text-muted-foreground">No assignments available yet.</p>
        ) : (
          <>
            <p className="text-muted-foreground mb-4">
              Click on any assignment below to view details and work on problems.
            </p>
            <div className="space-y-4">
              {course.assignments
                .filter((assignment) => assignment.isPublished)
                .map((assignment) => {
                  const isOverdue = new Date(assignment.dueDate) < new Date();

                  return (
                    <div
                      key={assignment.id}
                      className="group border-border bg-card hover:bg-accent flex h-full cursor-pointer overflow-hidden rounded-lg border shadow transition-all hover:shadow-md"
                      onClick={() =>
                        router.push(`/dashboard/courses/${course.id}/${assignment.id}`)
                      }
                    >
                      {/* Vertical colored bar - blue for assignments */}
                      <div className="bg-primary w-[15px]" />

                      {/* Content area */}
                      <div className="flex w-full flex-col px-4 py-4 sm:p-5">
                        {/* Title */}
                        <div className="mb-2 min-w-0">
                          <div className="text-md truncate font-semibold" title={assignment.title}>
                            {assignment.title}
                          </div>
                          {assignment.description && (
                            <div
                              className="text-muted-foreground mt-1 line-clamp-2 text-sm break-words"
                              title={assignment.description}
                            >
                              {limitText(assignment.description)}
                            </div>
                          )}
                        </div>

                        {/* Due Date and Metadata Row */}
                        <div className="flex flex-wrap items-center gap-4">
                          <div
                            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${
                              isOverdue
                                ? 'border border-red-200 bg-red-100'
                                : 'border border-green-200 bg-green-100'
                            }`}
                          >
                            <span
                              className={`text-sm ${isOverdue ? 'text-red-700' : 'text-green-700'}`}
                            >
                              ⏰
                            </span>
                            <span
                              className={`text-sm font-medium ${
                                isOverdue ? 'text-red-700' : 'text-green-700'
                              }`}
                            >
                              {isOverdue ? 'OVERDUE: ' : 'Due: '}
                              {formatDateInTimeZone(assignment.dueDate, timezone)} at{' '}
                              {formatTimeInTimeZone(assignment.dueDate, timezone)}
                            </span>
                          </div>

                          <div className="flex items-center gap-4 text-sm">
                            <div>
                              <span className="font-semibold">Problems:</span>{' '}
                              {assignment.problemCount}
                            </div>
                            <div>
                              <span className="font-semibold">Points:</span> {assignment.maxPoints}
                            </div>
                          </div>
                        </div>
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
