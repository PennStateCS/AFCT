'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Loader2, Table } from 'lucide-react';
import { formatDateInTimeZone } from '@/lib/date';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { apiPaths } from '@/lib/api-paths';

type StudentGradesResponse = {
  assignments: Array<{
    id: string;
    title: string;
    description?: string | null;
    dueDate: string | null;
    maxPoints: number;
    grade: number | null;
    problems: Array<{
      id: string;
      title: string | null;
      maxPoints: number;
      maxSubmissions: number;
      submissionCount: number;
      grade: number | null;
      status: string;
      autograderEnabled: boolean;
    }>;
  }>;
};

// Stable empty default so the value derived from the query keeps a constant
// identity between renders (keeps the memoized assignment rows stable).
const EMPTY_ASSIGNMENTS: StudentGradesResponse['assignments'] = [];

export function StudentGradesCard({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { timezone } = useEffectiveTimezone();
  const [expandedAssignments, setExpandedAssignments] = useState<string[]>([]);

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

  const assignmentRows = useMemo(() => {
    return assignments.map((assignment) => {
      const percentage =
        assignment.grade === null || assignment.maxPoints === 0
          ? null
          : Math.round((assignment.grade / assignment.maxPoints) * 100);

      return {
        ...assignment,
        percentage,
      };
    });
  }, [assignments]);

  const openProblem = useCallback(
    (assignmentId: string, problemId: string) => {
      router.push(
        `/dashboard/courses/${courseId}/${assignmentId}?problem=${encodeURIComponent(problemId)}`,
      );
    },
    [courseId, router],
  );

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="flex items-center gap-2 text-2xl">
          <Table className="h-5 w-5" />
          Grades
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 px-3 py-3">
        {loading ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading grades...
          </div>
        ) : error ? (
          <div className="text-destructive text-sm">{error}</div>
        ) : assignments.length === 0 ? (
          <div className="text-muted-foreground text-sm">No graded assignments available yet.</div>
        ) : (
          <div className="space-y-2">
            {assignmentRows.map((assignment) => (
              <div
                key={assignment.id}
                className="border-border/80 bg-card hover:border-primary hover:bg-primary/5 overflow-hidden rounded-xl border border-l-4 border-l-blue-600 shadow-sm transition hover:shadow-md"
              >
                <CardHeader className="p-0">
                  <div
                    className="flex cursor-pointer items-center justify-between gap-3 px-3 py-1"
                    onClick={() => router.push(`/dashboard/courses/${courseId}/${assignment.id}`)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-1">
                        <CardTitle className="text-sm leading-none">{assignment.title}</CardTitle>
                        <div className="text-muted-foreground flex flex-wrap gap-2 text-[10px]">
                          {assignment.dueDate ? (
                            <span className="border-border rounded-full border px-2 py-1 whitespace-nowrap">
                              Due {formatDateInTimeZone(assignment.dueDate, timezone)}
                            </span>
                          ) : null}
                          <span className="border-border rounded-full border px-2 py-1 whitespace-nowrap">
                            {assignment.problems.length} Problems
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      <p className="grid grid-cols-[4rem_minmax(4rem,auto)_4rem] items-center gap-2 text-[10px] tracking-[0.12em] uppercase">
                        <span className="text-foreground text-sm font-semibold">Grade</span>
                        <span className="text-foreground text-left text-sm font-semibold">
                          {(assignment.grade === null ? '-' : `${assignment.grade}`) +
                            `/${assignment.maxPoints}`}
                        </span>
                        <span className="text-muted-foreground text-right text-sm">
                          {assignment.grade !== null && assignment.percentage !== null
                            ? `${assignment.percentage}%`
                            : '-%'}
                        </span>
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        title={
                          expandedAssignments.includes(assignment.id)
                            ? 'Hide details'
                            : 'Show details'
                        }
                        aria-label={
                          expandedAssignments.includes(assignment.id)
                            ? 'Hide details'
                            : 'Show details'
                        }
                        onClick={(event) => {
                          event.stopPropagation();
                          setExpandedAssignments((current) =>
                            current.includes(assignment.id)
                              ? current.filter((id) => id !== assignment.id)
                              : [...current, assignment.id],
                          );
                        }}
                        className="h-7 w-7 p-1"
                      >
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${
                            expandedAssignments.includes(assignment.id) ? 'rotate-180' : ''
                          }`}
                        />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <Collapsible open={expandedAssignments.includes(assignment.id)}>
                  <CollapsibleContent className="border-border border-t bg-slate-50 px-2 py-2">
                    <div className="space-y-1">
                      {assignment.problems.map((problem, index) => (
                        <button
                          key={problem.id}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openProblem(assignment.id, problem.id);
                          }}
                          className="group border-border hover:border-primary hover:bg-primary/5 flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-2 py-2 text-left text-sm transition"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <p className="text-foreground truncate text-[13px] font-medium">
                              Problem {index + 1}: {problem.title ?? 'Untitled'}
                            </p>
                            <span className="border-border text-muted-foreground rounded-full border px-2 py-1 text-[10px]">
                              {problem.status.toLowerCase() == 'processing'
                                ? 'Evaluating'
                                : problem.grade === null &&
                                    (problem.status.toLowerCase() == 'failed' ||
                                      problem.status.toLowerCase() == 'completed')
                                  ? 'Processed'
                                  : problem.grade === null
                                    ? 'Not Graded'
                                    : 'Graded'}
                            </span>
                            <span className="border-border text-muted-foreground rounded-full border px-2 py-1 text-[10px]">
                              {problem.submissionCount ? problem.submissionCount : 0}/
                              {problem.maxSubmissions < 0 ? '∞' : problem.maxSubmissions}{' '}
                              Submissions
                            </span>
                            {problem.autograderEnabled && problem.submissionCount ? (
                              <span className="border-border text-muted-foreground rounded-full border px-2 py-1 text-[10px]">
                                {'Latest Status: ' + problem.status}
                              </span>
                            ) : (
                              <span></span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="border-border rounded-full border px-2 py-1 text-[10px] font-semibold text-slate-700">
                              {problem.grade === null
                                ? `-/${problem.maxPoints}`
                                : `${problem.grade}/${problem.maxPoints}`}{' '}
                              pts
                            </span>
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
