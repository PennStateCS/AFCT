'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronDown, TriangleAlert } from 'lucide-react';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import LoadingSpinner from '@/components/ui/loading-spinner';
import {
  EmptyChart,
  ExpandButton,
  ExpandedChart,
  StatCard,
} from '@/components/statistics/StatCard';
import { ScoreHistogramChart } from '@/components/statistics/charts/ScoreHistogramChart';
import { ProblemBoxPlotChart } from '@/components/statistics/charts/ProblemBoxPlotChart';
import { GradingProgressBar } from '@/components/statistics/charts/GradingProgressBar';
import { TurnInStatusBar } from '@/components/statistics/charts/TurnInStatusBar';
import { AttemptsPerProblemChart } from '@/components/statistics/charts/AttemptsPerProblemChart';
import { CumulativeActivityChart } from '@/components/statistics/charts/CumulativeActivityChart';
import { ActivityHeatmapChart } from '@/components/statistics/charts/ActivityHeatmapChart';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import type { CourseStatisticsPayload } from '@/lib/course-statistics-service';

/**
 * How a whole course is going.
 *
 * The assignment tab answers "how did this one go", down to the problem. This one answers
 * what only the term can: where the class stands, which assignment was the hard one, which
 * KIND of problem this class struggles with, and what is waiting on a grader across
 * everything at once. Nothing here goes inside a single assignment, and nothing here names a
 * student: both are one click away on screens built for them, with the audit trail that
 * reading a student's work is supposed to leave.
 */
export function CourseStatisticsPanel({ courseId }: { courseId: string }) {
  const [gradedOnly, setGradedOnly] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [expandHeatmap, setExpandHeatmap] = useState(false);

  const query = useQuery({
    queryKey: queryKeys.course.statistics(courseId),
    queryFn: async () => {
      const res = await fetch(apiPaths.courseStatistics(courseId));
      if (!res.ok) throw new Error('Failed to load statistics');
      return (await res.json()) as CourseStatisticsPayload;
    },
    enabled: !!courseId,
    staleTime: 30_000,
  });

  const heading = (
    <h2 className="flex items-center gap-2 text-xl font-semibold">
      <BarChart3 className="h-6 w-6" />
      Statistics
    </h2>
  );

  // One region that outlives every branch below, so somebody waiting on this tab hears both
  // the wait and its end. The assignment panel learned this the hard way.
  const announcer = (
    <span role="status" aria-live="polite" className="sr-only">
      {query.isPending
        ? 'Loading course statistics.'
        : query.isError || !query.data
          ? 'Course statistics could not be loaded.'
          : 'Course statistics loaded.'}
    </span>
  );

  if (query.isPending) {
    return (
      <div className="space-y-4">
        {heading}
        {announcer}
        <LoadingSpinner label="Loading statistics" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="space-y-4">
        {heading}
        <div
          role="alert"
          className="border-badge-danger-border bg-badge-danger-bg text-badge-danger flex items-center gap-2 rounded-lg border p-4 text-sm"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Could not load statistics for this course. Try refreshing the page.</span>
        </div>
      </div>
    );
  }

  const stats = query.data;
  const scores = gradedOnly ? stats.distributionGradedOnly : stats.distribution;
  const pct = (n: number) => `${Math.round(n)}%`;

  const summary = [
    `${scores.includedCount} student${scores.includedCount === 1 ? '' : 's'}`,
    scores.mean !== null ? `mean ${pct(scores.mean)}` : null,
    scores.median !== null ? `median ${pct(scores.median)}` : null,
    scores.low !== null && scores.high !== null
      ? `range ${pct(scores.low)} to ${pct(scores.high)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /**
   * What the denominator is made of.
   *
   * A course average in week 8 is mostly a statement about how much term is left, and
   * without this line a class that is doing fine reads as a class at 45%. Said under the
   * chart rather than in a tooltip, because it is the difference between the number being
   * useful and being alarming.
   */
  const denominatorNote = gradedOnly
    ? `Counting only work that has been graded, out of ${scores.assignmentsCounted} published assignment${scores.assignmentsCounted === 1 ? '' : 's'}.`
    : `Counting work that has been graded, plus work nobody handed in where the assignment scores that as zero, across ${scores.assignmentsCounted} published assignment${scores.assignmentsCounted === 1 ? '' : 's'}. Work still waiting to be marked counts toward neither, which is how the Grades tab computes its average too.`;

  const exclusionText = stats.exclusions.map((e) =>
    e.reason === 'dropped'
      ? `${e.count} dropped student${e.count === 1 ? '' : 's'}`
      : `${e.count} disabled account${e.count === 1 ? '' : 's'}`,
  );

  const turnInExceptions = stats.turnIn.reduce((n, row) => n + row.exceptions, 0);

  const workloadTotal = stats.workload.reduce(
    (n, row) => n + (row.states.find((s) => s.key === 'ungraded-submitted')?.count ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      {heading}
      {announcer}

      <div className="text-muted-foreground space-y-1 text-sm">
        <p>
          <span className="text-foreground font-medium">
            {stats.studentCount} student{stats.studentCount === 1 ? '' : 's'}
          </span>{' '}
          &middot; {stats.assignments.length} assignment
          {stats.assignments.length === 1 ? '' : 's'}
        </p>
        <p>
          Counted: enrolled, with an active account.
          {exclusionText.length > 0 ? ` Not counted: ${exclusionText.join(', ')}.` : ''}
        </p>
      </div>

      <div className="@container/course">
        <div className="grid grid-cols-1 gap-6 @[52rem]/course:grid-cols-3">
          <div className="space-y-6 @[52rem]/course:col-span-2">
            <StatCard
              title="Course grade distribution"
              description="Where the class stands overall, as a percentage of the work set so far."
            >
              {scores.includedCount > 0 ? (
                <>
                  <ScoreHistogramChart
                    bins={scores.bins}
                    mean={scores.mean}
                    median={scores.median}
                    includedCount={scores.includedCount}
                    unitPlural="students"
                  />
                  <p className="text-muted-foreground mt-2 text-xs">{summary}</p>
                  <p className="text-muted-foreground mt-1 text-xs">{denominatorNote}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Switch
                      id="course-graded-only"
                      aria-labelledby="course-graded-only-label"
                      checked={gradedOnly}
                      onCheckedChange={setGradedOnly}
                    />
                    <Label
                      id="course-graded-only-label"
                      htmlFor="course-graded-only"
                      className="text-muted-foreground text-xs font-normal"
                    >
                      Count only work that has been graded
                    </Label>
                  </div>
                </>
              ) : (
                <EmptyChart message="Nothing is graded yet." />
              )}
            </StatCard>

            <StatCard
              title="How the assignments compare"
              description="Each assignment's spread, in the order the class met them, on a shared 0-100% scale."
            >
              {stats.assignments.some((a) => a.boxplot) ? (
                <ProblemBoxPlotChart
                  problems={stats.assignments.map((a) => ({
                    id: a.id,
                    title: a.title,
                    order: a.dueAt,
                    maxPoints: a.maxPoints,
                    pointsLostMean: a.pointsLostMean,
                    boxplot: a.boxplot,
                    gradedCount: a.gradedCount,
                    ungradedCount: Math.max(0, a.participantCount - a.gradedCount),
                  }))}
                  unitPlural="participants"
                />
              ) : (
                <EmptyChart message="No assignment has been graded yet." />
              )}
            </StatCard>

            <StatCard
              title="Performance by problem type"
              description="How the class does on each kind of work the course sets."
            >
              {stats.problemTypes.some((t) => t.boxplot) ? (
                <ProblemBoxPlotChart
                  problems={stats.problemTypes.map((t, index) => ({
                    id: t.type,
                    title: t.title,
                    // A topic is not worth points, it is a share of the course's work, so
                    // the row says how much of it has been marked instead.
                    subtitle: `${t.gradedCount} of ${t.totalCount} graded`,
                    order: index,
                    boxplot: t.boxplot,
                    gradedCount: t.gradedCount,
                    ungradedCount: Math.max(0, t.totalCount - t.gradedCount),
                  }))}
                  unitPlural="pieces of work"
                />
              ) : (
                <EmptyChart message="Nothing of any type is graded yet." />
              )}
            </StatCard>

            <StatCard
              title="Attempts by problem type"
              description="How many submissions each kind of problem takes before it comes right, with the share solved straight away."
            >
              {stats.attemptsByType.length > 0 ? (
                <AttemptsPerProblemChart
                  problems={stats.attemptsByType.map((row) => ({
                    id: row.type,
                    title: row.title,
                    attempts: row.attempts,
                    firstTry: row.firstTry,
                  }))}
                  unitPlural="attempts at a problem"
                  rowHeader="Problem type"
                />
              ) : (
                <EmptyChart message="No submissions yet." />
              )}
            </StatCard>

            <StatCard
              title="When the class is working"
              description="Every submission in the course adding up, with each assignment's due date marked. It counts attempts, so somebody going ten rounds with the autograder shows here as ten: the question is when work is happening, not how much of it is finished."
            >
              {stats.timeline.length > 0 ? (
                <CumulativeActivityChart
                  timeline={stats.timeline}
                  markers={stats.dueDates.map((d) => ({
                    id: d.id,
                    label: d.title,
                    at: new Date(d.dueAt).toISOString(),
                  }))}
                  timeZone={stats.timezone}
                  unitPlural="students"
                />
              ) : (
                <EmptyChart message="No submissions yet." />
              )}
            </StatCard>

            <Card>
              <Collapsible open={showHeatmap} onOpenChange={setShowHeatmap}>
                <CardHeader>
                  <CardTitle aria-level={3} className="text-base">
                    <CollapsibleTrigger className="focus-visible:ring-ring flex w-full items-center gap-2 text-start focus-visible:ring-2 focus-visible:outline-none">
                      <ChevronDown
                        className={`text-muted-foreground size-4 shrink-0 transition-transform ${
                          showHeatmap ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                      When submissions happen
                    </CollapsibleTrigger>
                  </CardTitle>
                  <CardDescription>
                    A term of submission attempts by day of week and hour, in course time.
                  </CardDescription>
                  <CardAction>
                    <ExpandButton
                      title="When submissions happen"
                      onClick={() => {
                        setShowHeatmap(true);
                        setExpandHeatmap(true);
                      }}
                    />
                  </CardAction>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent>
                    {stats.heatmap.max > 0 ? (
                      <ActivityHeatmapChart
                        matrix={stats.heatmap.matrix}
                        max={stats.heatmap.max}
                        unitPlural="students"
                      />
                    ) : (
                      <EmptyChart message="No submissions yet." />
                    )}
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
              <ExpandedChart
                title="When submissions happen"
                description="A term of submission attempts by day of week and hour, in course time."
                open={expandHeatmap}
                onOpenChange={setExpandHeatmap}
              >
                {stats.heatmap.max > 0 ? (
                  <ActivityHeatmapChart
                    matrix={stats.heatmap.matrix}
                    max={stats.heatmap.max}
                    unitPlural="students"
                  />
                ) : (
                  <EmptyChart message="No submissions yet." />
                )}
              </ExpandedChart>
            </Card>
          </div>

          <div className="space-y-6">
            <StatCard
              title="Grading workload"
              description={`What is waiting on a grader, counted in pieces of work: one participant's one problem.${workloadTotal > 0 ? ` ${workloadTotal} to go.` : ''}`}
            >
              {stats.workload.some((row) => row.total > 0) ? (
                <GradingProgressBar
                  series={stats.workload
                    .filter((row) => row.total > 0)
                    .map((row) => ({
                      id: row.assignmentId,
                      label: row.title,
                      grading: row.states,
                    }))}
                  total={Math.max(...stats.workload.map((row) => row.total))}
                  unitPlural="pieces of work"
                  rowHeader="Assignment"
                />
              ) : (
                <EmptyChart message="No assignments to grade yet." />
              )}
            </StatCard>

            <StatCard
              title="Turn-in status"
              description={`Whether the work arrived by each participant's own deadline, assignment by assignment.${turnInExceptions > 0 ? ` ${turnInExceptions} held to a different date.` : ''}`}
            >
              {stats.turnIn.some((row) => row.total > 0) ? (
                <TurnInStatusBar
                  series={stats.turnIn
                    .filter((row) => row.total > 0)
                    .map((row) => ({ id: row.assignmentId, label: row.title, turnIn: row.states }))}
                  total={Math.max(...stats.turnIn.map((row) => row.total))}
                  unitPlural="participants"
                  rowHeader="Assignment"
                />
              ) : (
                <EmptyChart message="Nothing has been set yet." />
              )}
            </StatCard>

            <StatCard
              title="Worth a second look"
              description="Counts only. Who they are is in the Grades tab, which is the screen built to name them."
            >
              <ul className="space-y-2 text-sm">
                <li>
                  <span className="text-foreground font-medium tabular-nums">
                    {stats.atRisk.belowThreshold}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    below {stats.atRisk.threshold}% on the reading above
                  </span>
                </li>
                <li>
                  <span className="text-foreground font-medium tabular-nums">
                    {stats.atRisk.missingTwoOrMore}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    with two or more assignments not handed in
                  </span>
                </li>
              </ul>
            </StatCard>
          </div>
        </div>
      </div>
    </div>
  );
}
