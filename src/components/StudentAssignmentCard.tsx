'use client';

import Link from 'next/link';
import { ChevronRight, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/lib/date-format';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import type { FullCourse } from '@/types/course';

interface StudentAssignmentCardProps {
  course: FullCourse;
}

/**
 * The student's Assignments workspace: a heading and a list of assignment rows.
 *
 * No outer Card. This IS the page's active panel, so wrapping it put a bounded thing
 * inside a bounded thing and left the rows reading as cards inside a card. Each row keeps
 * its own border, because a row is a real object you click.
 */
export function StudentAssignmentCard({ course }: StudentAssignmentCardProps) {
  const { timezone } = useEffectiveTimezone();
  const limitText = (value: string, max = 140) =>
    value.length > max ? `${value.slice(0, max - 1)}…` : value;

  const publishedAssignments = course.assignments.filter((assignment) => assignment.isPublished);
  const stamp = (date: Date) =>
    `${formatDateInTimeZone(date, timezone)} at ${formatTimeInTimeZone(date, timezone)}`;

  return (
    <section className="space-y-6" aria-labelledby="student-assignments-title">
      <div className="space-y-1">
        <h2 id="student-assignments-title" className="text-xl font-semibold">
          Assignments
        </h2>
        {publishedAssignments.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            Click an assignment below to view details and work on problems.
          </p>
        ) : null}
      </div>

      {publishedAssignments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No assignments are available yet.</p>
      ) : (
        <div className="space-y-6">
          {publishedAssignments.map((assignment) => {
            const dueDate = new Date(assignment.dueDate);
            const isOverdue = dueDate < new Date();
            const allowLateSubmissions = assignment.allowLateSubmissions ?? false;
            const lateCutoffDate = assignment.lateCutoff ? new Date(assignment.lateCutoff) : null;

            // One quiet line rather than four labelled pairs. "Late Cutoff: Never" was the
            // worst of them: the value is absent, not a date called Never, and what a
            // student needs to know is that there is no deadline after the due date.
            const meta = [
              `${assignment.problemCount} ${assignment.problemCount === 1 ? 'problem' : 'problems'}`,
              `${assignment.maxPoints} points`,
              allowLateSubmissions
                ? lateCutoffDate
                  ? `Late until ${stamp(lateCutoffDate)}`
                  : 'Late submissions allowed'
                : null,
            ].filter(Boolean);

            return (
              <Link
                key={assignment.id}
                href={`/dashboard/courses/${course.id}/${assignment.id}`}
                // A 4px edge, not the 15px block this used to carry: it marks the row
                // without becoming the loudest thing in the workspace. No shadow jump on
                // hover either; the tint and the border say enough.
                className="group border-border border-l-primary bg-card hover:border-primary/50 hover:bg-primary/5 focus-visible:ring-ring flex items-center gap-3 rounded-lg border border-l-4 px-4 py-4 shadow-xs transition-colors focus-visible:ring-2 focus-visible:outline-none sm:px-5"
              >
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="min-w-0">
                    <p
                      className="text-foreground truncate text-sm font-semibold"
                      title={assignment.title}
                    >
                      {assignment.title}
                    </p>
                    {assignment.description ? (
                      <p
                        className="text-muted-foreground mt-1 line-clamp-2 text-sm break-words"
                        title={assignment.description}
                      >
                        {limitText(assignment.description)}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    {/* A future deadline is information, not a success. Green was claiming
                        something had gone right about an assignment nobody had started.
                        Overdue keeps the danger tint AND says so in words. */}
                    <Badge variant={isOverdue ? 'danger' : 'info'} className="gap-1.5 px-2 py-1">
                      <Clock className="size-3.5" aria-hidden="true" />
                      {isOverdue ? 'OVERDUE: ' : 'Due '}
                      {stamp(dueDate)}
                    </Badge>
                    <span className="text-muted-foreground text-xs">{meta.join(' · ')}</span>
                  </div>
                </div>

                <ChevronRight
                  className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
                  aria-hidden="true"
                />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
