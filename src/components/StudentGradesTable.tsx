'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';

import LoadingSpinner from '@/components/ui/loading-spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import { formatDateInTimeZone } from '@/lib/date-format';
import { TEXT_LINK_CLASS } from '@/lib/link-styles';
import { cn } from '@/lib/utils';

type StudentGradesProblem = {
  id: string;
  title: string | null;
  maxPoints: number;
  maxSubmissions: number;
  submissionCount: number;
  grade: number | null;
  status: string;
  autograderEnabled: boolean;
};

type StudentGradesAssignment = {
  id: string;
  title: string;
  description?: string | null;
  dueDate: string | null;
  maxPoints: number;
  grade: number | null;
  problems: StudentGradesProblem[];
};

type StudentGradesResponse = { assignments: StudentGradesAssignment[] };

// Stable empty default so the value derived from the query keeps a constant
// identity between renders.
const EMPTY_ASSIGNMENTS: StudentGradesAssignment[] = [];

/** The placeholder a gradebook uses for a number that does not exist yet. */
const NONE = '—';

/**
 * How far a student is through one problem, in their words rather than the queue's.
 *
 * `status` is the latest submission's evaluator state, so "the autograder finished but
 * nobody has a grade" is a real and common combination: that is `Processed`, and it is
 * different from a problem nothing has been submitted to.
 */
export function problemStatusLabel(problem: StudentGradesProblem): string {
  const status = problem.status?.toLowerCase() ?? '';
  if (status === 'processing') return 'Evaluating';
  if (problem.grade !== null) return 'Graded';
  if (status === 'failed' || status === 'completed') return 'Processed';
  return 'Not graded';
}

/**
 * The assignment's status, derived from its problems rather than stored. An assignment
 * whose problems are half marked is the case a student most needs to see, because it
 * tells them the score in front of them is not final.
 */
export function assignmentStatusLabel(problems: StudentGradesProblem[]): string {
  const graded = problems.filter((p) => p.grade !== null).length;
  if (graded === 0) return 'Not graded';
  if (graded === problems.length) return 'Graded';
  return 'Partially graded';
}

/** `35 / 50`, or `— / 50` when nothing has been marked. Spaces around the slash: this is a score, not a fraction. */
export function formatScore(grade: number | null, maxPoints: number): string {
  return `${grade === null ? NONE : grade} / ${maxPoints}`;
}

/** `70%`, or the placeholder when there is no grade or nothing to divide by. */
export function formatPercent(grade: number | null, maxPoints: number): string {
  if (grade === null || maxPoints <= 0) return NONE;
  return `${Math.round((grade / maxPoints) * 100)}%`;
}

/**
 * The student's Grades workspace: their own gradebook for one course.
 *
 * A table, not the card-per-assignment list this used to be. The question it exists to
 * answer is "I know my assignment grade, which problem caused it", and that is a
 * comparison across rows: cards put every score in a different place on the screen and
 * made the reader hold the numbers in their head.
 *
 * Two rules the layout keeps. The assignment name is a link to the assignment and the
 * chevron beside it is a button that opens the problems, so navigating and expanding
 * never compete for one click target. And each problem row is a link of its own, because
 * "which problem" is a destination, not a detail.
 *
 * Narrow screens keep the same table and the same rows; the Due, Status and Percent
 * columns fold into a second line under the name and the score. `hidden` removes an
 * element from the accessibility tree, so exactly one copy of each value is announced
 * whatever the width.
 */
export function StudentGradesTable({ courseId }: { courseId: string }) {
  const { timezone } = useEffectiveTimezone();
  const [expanded, setExpanded] = useState<string[]>([]);

  const gradesQuery = useQuery({
    queryKey: ['course', courseId, 'student-grades'],
    queryFn: async () => {
      const res = await fetch(apiPaths.courseStudentGrades(courseId));
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to load grades');
      }
      return (await res.json()) as StudentGradesResponse;
    },
    staleTime: 30_000,
  });

  const loading = gradesQuery.isPending;
  const error = gradesQuery.isError
    ? gradesQuery.error instanceof Error
      ? gradesQuery.error.message
      : 'Unable to load grades'
    : null;
  const assignments = gradesQuery.data?.assignments ?? EMPTY_ASSIGNMENTS;

  const toggle = useCallback((assignmentId: string) => {
    setExpanded((current) =>
      current.includes(assignmentId)
        ? current.filter((id) => id !== assignmentId)
        : [...current, assignmentId],
    );
  }, []);

  return (
    // No outer Card: this is the page's active panel, so wrapping it would put a bounded
    // thing inside a bounded thing.
    <section className="space-y-6" aria-labelledby="student-grades-title">
      <h2 id="student-grades-title" className="text-xl font-semibold">
        Grades
      </h2>

      {loading ? (
        <LoadingSpinner label="Loading grades" fullScreen={false} className="min-h-32" />
      ) : error ? (
        <div role="alert" className="text-destructive text-sm">
          {error}
        </div>
      ) : assignments.length === 0 ? (
        <p className="text-muted-foreground text-sm">No graded assignments available yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table aria-labelledby="student-grades-title">
            <TableHeader>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableHead>Assignment / Problem</TableHead>
                <TableHead className="hidden sm:table-cell">Due</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Percent</TableHead>
              </TableRow>
            </TableHeader>

            {assignments.map((assignment) => {
              const isExpanded = expanded.includes(assignment.id);
              const status = assignmentStatusLabel(assignment.problems);
              const due = assignment.dueDate
                ? formatDateInTimeZone(assignment.dueDate, timezone)
                : NONE;

              return (
                // One body per assignment, so its problems are grouped with it and the
                // border between groups falls where a reader expects it.
                <TableBody key={assignment.id}>
                  <TableRow className="bg-muted/40 hover:bg-muted/70">
                    <TableCell className="py-2">
                      <div className="flex items-start gap-1">
                        <button
                          type="button"
                          onClick={() => toggle(assignment.id)}
                          // aria-expanded and no aria-controls: the problems are several
                          // sibling rows with no element of their own to name, and pointing
                          // at the group would name a region containing this button. The
                          // rows follow it in reading order, which is what a disclosure
                          // needs.
                          aria-expanded={isExpanded}
                          // Icon is small, the target is not: 32px square, which keeps it
                          // usable on a phone without making the row tall.
                          className="hover:bg-muted focus-visible:ring-ring -ml-1 flex size-8 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
                          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${assignment.title} problems`}
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="size-4" aria-hidden="true" />
                          )}
                        </button>
                        <div className="min-w-0 pt-1">
                          <Link
                            href={`/dashboard/courses/${courseId}/${assignment.id}`}
                            className={cn(TEXT_LINK_CLASS, 'font-semibold')}
                          >
                            {assignment.title}
                          </Link>
                          {/* The folded Due and Status columns. Only one of the two
                              copies is in the accessibility tree at any width. */}
                          <p className="text-muted-foreground text-xs sm:hidden">
                            {assignment.dueDate ? `${due} • ` : ''}
                            {status}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell nowrap className="hidden py-2 sm:table-cell">
                      {due}
                    </TableCell>
                    <TableCell nowrap className="hidden py-2 sm:table-cell">
                      {status}
                    </TableCell>
                    <TableCell nowrap className="py-2 text-right font-semibold tabular-nums">
                      {formatScore(assignment.grade, assignment.maxPoints)}
                      <span className="text-muted-foreground block text-xs font-normal sm:hidden">
                        {formatPercent(assignment.grade, assignment.maxPoints)}
                      </span>
                    </TableCell>
                    <TableCell
                      nowrap
                      className="hidden py-2 text-right font-semibold tabular-nums sm:table-cell"
                    >
                      {formatPercent(assignment.grade, assignment.maxPoints)}
                    </TableCell>
                  </TableRow>

                  {isExpanded
                    ? assignment.problems.map((problem, index) => {
                        const problemStatus = problemStatusLabel(problem);
                        return (
                          <TableRow key={problem.id} className="hover:bg-muted/50">
                            {/* Indented under the assignment name, and named "Problem N",
                                so the hierarchy survives without the background tint. */}
                            <TableCell className="py-1.5 pl-9 sm:pl-10">
                              <Link
                                href={`/dashboard/courses/${courseId}/${assignment.id}?problem=${encodeURIComponent(problem.id)}`}
                                className={cn(TEXT_LINK_CLASS, 'font-normal')}
                              >
                                Problem {index + 1}: {problem.title ?? 'Untitled'}
                              </Link>
                              <p className="text-muted-foreground text-xs sm:hidden">
                                {problemStatus}
                              </p>
                            </TableCell>
                            {/* Deliberately empty: repeating the assignment's due date on
                                every problem would read as a per-problem deadline. */}
                            <TableCell className="hidden py-1.5 sm:table-cell" />
                            <TableCell nowrap className="hidden py-1.5 sm:table-cell">
                              {problemStatus}
                            </TableCell>
                            <TableCell nowrap className="py-1.5 text-right tabular-nums">
                              {formatScore(problem.grade, problem.maxPoints)}
                              <span className="text-muted-foreground block text-xs sm:hidden">
                                {formatPercent(problem.grade, problem.maxPoints)}
                              </span>
                            </TableCell>
                            <TableCell
                              nowrap
                              className="hidden py-1.5 text-right tabular-nums sm:table-cell"
                            >
                              {formatPercent(problem.grade, problem.maxPoints)}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    : null}
                </TableBody>
              );
            })}
          </Table>
        </div>
      )}
    </section>
  );
}
