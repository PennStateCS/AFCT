'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Loader2, Table } from 'lucide-react';
import { formatDateInTimeZone, formatTimeInTimeZone } from '@/lib/date';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';

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

export function StudentGradesCard({ courseId }: { courseId: string }) {
  const router = useRouter();
  const { timezone } = useEffectiveTimezone();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<StudentGradesResponse['assignments']>([]);
  const [expandedAssignments, setExpandedAssignments] = useState<string[]>([]);

  const fetchGrades = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/courses/${courseId}/student-grades`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to load grades');
      }

      const body = (await res.json()) as StudentGradesResponse;
      setAssignments(body.assignments);
    } catch (err) {
      console.error('Student grades load error:', err);
      setError(err instanceof Error ? err.message : 'Unable to load grades');
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void fetchGrades();
  }, [fetchGrades]);

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
      router.push(`/dashboard/courses/${courseId}/${assignmentId}?problem=${encodeURIComponent(problemId)}`);
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading grades...
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : assignments.length === 0 ? (
          <div className="text-sm text-muted-foreground">No graded assignments available yet.</div>
        ) : (
          <div className="space-y-2">
            {assignmentRows.map((assignment) => (
              <div
                key={assignment.id}
                className="overflow-hidden rounded-xl border border-border/80 border-l-4 border-l-blue-600 bg-card shadow-sm transition hover:border-primary hover:bg-primary/5 hover:shadow-md"
              >
                <CardHeader className="p-0">
                  <div
                    className="flex items-center justify-between gap-3 cursor-pointer px-3 py-1"
                    onClick={() => router.push(`/dashboard/courses/${courseId}/${assignment.id}`)}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-sm leading-none">
                          {assignment.title}
                        </CardTitle>
                        <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                          {assignment.dueDate ? (
                            <span className="rounded-full border border-border px-2 py-1">
                              Due {formatDateInTimeZone(assignment.dueDate, timezone)}
                            </span>
                          ) : null}
                          <span className="rounded-full border border-border px-2 py-1">
                            {assignment.problems.length} Problems
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      <p className="grid grid-cols-[4rem_minmax(4rem,auto)_4rem] items-center gap-2 text-[10px] uppercase tracking-[0.12em]">
                        <span className="text-sm font-semibold text-foreground">Grade</span>
                        <span className="text-sm font-semibold text-foreground text-left">
                          {(assignment.grade === null ? '-' : `${assignment.grade}`) + `/${assignment.maxPoints}`}
                        </span>
                        <span className="text-right text-[10px] text-muted-foreground">
                          {assignment.grade !== null && assignment.percentage !== null ? `${assignment.percentage}%` : '-%'}
                        </span>
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        title={expandedAssignments.includes(assignment.id) ? 'Hide details' : 'Show details'}
                        aria-label={expandedAssignments.includes(assignment.id) ? 'Hide details' : 'Show details'}
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
                  <CollapsibleContent className="border-t border-border bg-slate-50 px-2 py-2">
                    <div className="space-y-1">
                      {assignment.problems.map((problem, index) => (
                        <button
                          key={problem.id}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            openProblem(assignment.id, problem.id);
                          }}
                          className="group flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-white px-2 py-2 text-left text-sm transition hover:border-primary hover:bg-primary/5"
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <p className="truncate font-medium text-foreground text-[13px]">
                              Problem {index + 1}: {problem.title ?? 'Untitled'}
                            </p>
                            <span className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">
                              {problem.status.toLowerCase() == "processing" ? 'Grading' : (problem.grade === null) ? 'Not Graded' : 'Graded'}
                            </span>
                            <span className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">
                              {problem.submissionCount ? problem.submissionCount : 0}/{problem.maxSubmissions < 0 ? '∞' : problem.maxSubmissions} Submissions
                            </span>
                            { (problem.autograderEnabled && problem.submissionCount ) ? (
                              <span className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">
                                {"Latest Status: " + problem.status}
                              </span>
                              ) : ( <span></span> )
                            }
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full border border-border px-2 py-1 text-[10px] font-semibold text-slate-700">
                              {problem.grade === null ? `-/${problem.maxPoints}` : `${problem.grade}/${problem.maxPoints}`} pts
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
