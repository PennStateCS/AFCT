'use client';

import { Fragment, useCallback, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight } from 'lucide-react';

import LoadingSpinner from '@/components/ui/loading-spinner';
import { Table, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';
import { formatDateInTimeZone } from '@/lib/date-format';
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
 * How a name reads inside a table row here.
 *
 * Not `TEXT_LINK_CLASS`, which paints a link blue and underlined from the start. Nearly
 * every cell in the first column is a link, and that treatment turns a gradebook into a
 * page of blue text. These read as the row's own label and become a link on hover, which
 * is what an application table does; the focus ring is what keeps them findable without a
 * mouse.
 */
const ROW_LINK_CLASS =
  'text-foreground hover:text-primary focus-visible:ring-ring inline-block max-w-full cursor-pointer truncate rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none';

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
  // "Not graded" is true of a problem nobody has submitted to, but it is not the fact the
  // student needs. `Not submitted` is the wording the student guide already uses for it.
  if (problem.submissionCount === 0) return 'Not submitted';
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
            {/* Deliberate proportions. Left to itself the table spreads five columns over the
                full width and the grade, which is the thing being read, ends up a screen away
                from the assignment it belongs to. A hidden column contributes no cells, so a
                width on a hidden header is simply ignored. */}
            <TableHeader>
              <TableRow
                // The same header colour every other table in the app uses, rather than a
                // muted tint that happens to look similar. An inline style, as there, because
                // the token is a CSS variable rather than a Tailwind palette entry.
                style={{
                  backgroundColor: 'var(--table-header)',
                  color: 'var(--table-header-foreground)',
                }}
              >
                <TableHead className="h-9 w-[46%] px-3 text-xs">Assignment / Problem</TableHead>
                <TableHead className="hidden h-9 w-[15%] px-3 text-xs md:table-cell">Due</TableHead>
                <TableHead className="hidden h-9 w-[15%] px-3 text-xs sm:table-cell">
                  Status
                </TableHead>
                <TableHead className="h-9 w-[14%] px-3 text-right text-xs">Score</TableHead>
                <TableHead className="hidden h-9 w-[10%] px-3 text-right text-xs sm:table-cell">
                  Percent
                </TableHead>
              </TableRow>
            </TableHeader>

            {/* A raw tbody, not the TableBody primitive, and one for the whole table.
                Grouping here is done with borders on the rows: a border on a row group is
                ignored under the separated-borders model browsers use by default, and
                TableBody's `[&_tr:last-child]:border-0` would zero the border-t on the last
                assignment row, which is the line separating it from the group above. That
                rule out-specifies any class we could put on the row, and every assignment
                starts collapsed, so it would have shown on arrival. */}
            <tbody>
              {assignments.map((assignment, assignmentIndex) => {
                const isExpanded = expanded.includes(assignment.id);
                const status = assignmentStatusLabel(assignment.problems);
                // The placeholder is for the assignment only. A problem's Due cell is left
                // genuinely blank, because a problem has no deadline to be missing.
                const due = assignment.dueDate
                  ? formatDateInTimeZone(assignment.dueDate, timezone)
                  : NONE;

                return (
                  <Fragment key={assignment.id}>
                    <TableRow
                      className={cn(
                        // The group's header: tinted, taller than its problems, and carrying
                        // the line that separates this assignment from the one above.
                        'bg-muted/40 hover:bg-muted/70 border-b-0 sm:h-11',
                        assignmentIndex > 0 && 'border-t',
                        isExpanded && 'border-b',
                      )}
                    >
                      <TableCell className="px-3 py-1.5">
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
                            // The icon stays small; the target does not. 32px square, which is
                            // reachable on a phone without making every row that tall.
                            className="hover:bg-background/80 focus-visible:ring-ring text-muted-foreground hover:text-foreground -ml-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${assignment.title} problems`}
                          >
                            {isExpanded ? (
                              <ChevronDown className="size-4" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="size-4" aria-hidden="true" />
                            )}
                          </button>
                          <div className="min-w-0 pt-1.5">
                            <Link
                              href={`/dashboard/courses/${courseId}/${assignment.id}`}
                              className={cn(ROW_LINK_CLASS, 'font-semibold')}
                            >
                              {assignment.title}
                            </Link>
                            {/* Due and Status folded under the title at the widths where
                                their columns are gone. `hidden` takes an element out of the
                                accessibility tree, so each value is announced exactly once
                                whatever the width. */}
                            <p className="text-muted-foreground text-xs md:hidden">
                              {due}
                              <span className="sm:hidden"> • {status}</span>
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell nowrap className="text-muted-foreground hidden px-3 md:table-cell">
                        {due}
                      </TableCell>
                      <TableCell nowrap className="text-muted-foreground hidden px-3 sm:table-cell">
                        {status}
                      </TableCell>
                      <TableCell nowrap className="px-3 text-right font-semibold tabular-nums">
                        {formatScore(assignment.grade, assignment.maxPoints)}
                        <span className="text-muted-foreground block text-xs font-normal sm:hidden">
                          {formatPercent(assignment.grade, assignment.maxPoints)}
                        </span>
                      </TableCell>
                      <TableCell
                        nowrap
                        className="hidden px-3 text-right font-semibold tabular-nums sm:table-cell"
                      >
                        {formatPercent(assignment.grade, assignment.maxPoints)}
                      </TableCell>
                    </TableRow>

                    {isExpanded
                      ? assignment.problems.map((problem, index) => {
                          const problemStatus = problemStatusLabel(problem);
                          return (
                            <TableRow
                              key={problem.id}
                              className="hover:bg-muted/40 border-b-0 sm:h-9"
                            >
                              <TableCell className="px-3 py-1">
                                {/* Indented, and with a hairline running down the indent so
                                    the rows read as belonging to the assignment above even
                                    when the tint is not what the eye is using. */}
                                <div className="border-border ml-3 border-l pl-4">
                                  <Link
                                    href={`/dashboard/courses/${courseId}/${assignment.id}?problem=${encodeURIComponent(problem.id)}`}
                                    className={cn(ROW_LINK_CLASS, 'text-[0.8125rem]')}
                                  >
                                    Problem {index + 1}: {problem.title ?? 'Untitled'}
                                  </Link>
                                  <p className="text-muted-foreground text-xs sm:hidden">
                                    {problemStatus}
                                  </p>
                                </div>
                              </TableCell>
                              {/* Left empty on purpose. A problem has no deadline of its own,
                                  and repeating the assignment's would read as if it did. */}
                              <TableCell className="hidden px-3 md:table-cell" />
                              <TableCell
                                nowrap
                                className="text-muted-foreground hidden px-3 text-[0.8125rem] sm:table-cell"
                              >
                                {problemStatus}
                              </TableCell>
                              <TableCell
                                nowrap
                                className="px-3 text-right text-[0.8125rem] tabular-nums"
                              >
                                {formatScore(problem.grade, problem.maxPoints)}
                                <span className="text-muted-foreground block text-xs sm:hidden">
                                  {formatPercent(problem.grade, problem.maxPoints)}
                                </span>
                              </TableCell>
                              <TableCell
                                nowrap
                                className="hidden px-3 text-right text-[0.8125rem] tabular-nums sm:table-cell"
                              >
                                {formatPercent(problem.grade, problem.maxPoints)}
                              </TableCell>
                            </TableRow>
                          );
                        })
                      : null}
                  </Fragment>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </section>
  );
}
