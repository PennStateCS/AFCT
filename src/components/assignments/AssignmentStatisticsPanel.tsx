'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { BarChart3, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone, zoneAbbrev } from '@/lib/date-format';
import type { AssignmentStatistics } from '@/lib/assignment-statistics';
import { ScoreHistogramChart } from './charts/ScoreHistogramChart';
import { SubmissionStatusBar } from './charts/SubmissionStatusBar';
import { GradingProgressBar } from './charts/GradingProgressBar';
import { ProblemBoxPlotChart } from './charts/ProblemBoxPlotChart';
import { AttemptsPerProblemChart } from './charts/AttemptsPerProblemChart';
import { FirstAttemptChart } from './charts/FirstAttemptChart';
import { SubmissionTimelineChart } from './charts/SubmissionTimelineChart';
import { ActivityHeatmapChart } from './charts/ActivityHeatmapChart';

// Mirrors the server payload (assignment-statistics-service). Declared here rather than
// imported so this client component never pulls the Prisma-backed service into the bundle.
type StatisticsPayload = AssignmentStatistics & {
  assignmentTitle: string;
  baseDueDate: string;
  timezone: string;
};

function StatCard({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle aria-level={3} className="text-base">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="text-muted-foreground flex min-h-[8rem] flex-col items-center justify-center gap-1 text-center text-sm">
      <p>{message}</p>
    </div>
  );
}

export function AssignmentStatisticsPanel() {
  const { id: courseId, aid: assignmentId } = useParams<{ id: string; aid: string }>();
  const { hour12 } = useEffectiveTimezone();

  const query = useQuery({
    queryKey: queryKeys.assignment.statistics(courseId, assignmentId),
    queryFn: async () => {
      const res = await fetch(apiPaths.assignmentStatistics(courseId, assignmentId));
      if (!res.ok) throw new Error('Failed to load statistics');
      return (await res.json()) as StatisticsPayload;
    },
    enabled: !!courseId && !!assignmentId,
    staleTime: 30_000,
  });

  const heading = (
    <h2 className="flex items-center gap-2 text-xl font-semibold">
      <BarChart3 className="h-6 w-6" />
      Statistics
    </h2>
  );

  /**
   * One region that outlives every branch below.
   *
   * The spinner carried `role="status"`, but it was mounted with its message and then replaced
   * wholesale by the charts: a live region inserted together with its text is not reliably
   * announced, and swapping it out announces nothing at all. So somebody waiting on this tab
   * heard neither the wait nor its end. Rendered in each branch so it is never unmounted.
   */
  const announcer = (
    <span role="status" aria-live="polite" className="sr-only">
      {query.isPending
        ? 'Loading statistics.'
        : query.isError || !query.data
          ? 'Statistics could not be loaded.'
          : 'Statistics loaded.'}
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
        {/* No announcer here: the alert below announces on its own, and two regions covering
            one status say it twice. */}
        <div
          role="alert"
          className="border-badge-danger-border bg-badge-danger-bg text-badge-danger flex items-center gap-2 rounded-lg border p-4 text-sm"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Could not load statistics for this assignment. Try refreshing the page.</span>
        </div>
      </div>
    );
  }

  const stats = query.data;
  const unitPlural = stats.unit === 'group' ? 'groups' : 'students';
  const statusTotal = stats.participantCount;

  const dueText =
    `${formatDateTimeInTimeZone(stats.baseDueDate, stats.timezone, hour12)} ${zoneAbbrev(
      stats.baseDueDate,
      stats.timezone,
    )}`.trim();
  const exceptionText = `${stats.exceptionCount} due-date exception${stats.exceptionCount === 1 ? '' : 's'}`;

  /**
   * Who these figures are about, in the reader's words.
   *
   * Every number on this page has the same denominator, and it is not "everybody on the
   * roster": a student who dropped, a disabled account, a team with nobody left in it and a
   * student who was never put in a group are all left out, for four different reasons. Said
   * plainly here, the tab and the gradebook can be reconciled by reading rather than by
   * counting; unsaid, the gap looks like a bug in whichever screen is read second.
   */
  const EXCLUSION_TEXT: Record<(typeof stats.exclusions)[number]['reason'], (n: number) => string> =
    {
      dropped: (n) => `${n} dropped student${n === 1 ? '' : 's'}`,
      inactive: (n) => `${n} disabled account${n === 1 ? '' : 's'}`,
      'no-group': (n) => `${n} student${n === 1 ? ' is' : 's are'} in no group and cannot submit`,
      'empty-group': (n) => `${n} group${n === 1 ? ' has' : 's have'} no active members left`,
    };
  const exclusionText = stats.exclusions.map((e) => EXCLUSION_TEXT[e.reason](e.count));

  // The queue is worth showing while work is moving through it. A FAILED evaluation is not
  // movement, it is a job to do, so it is reported with grading progress instead and never
  // keeps this bar on screen for the rest of term.
  const inFlight = stats.problems.reduce(
    (total, problem) =>
      total +
      problem.status
        .filter((s) => s.key === 'pending' || s.key === 'processing')
        .reduce((n, s) => n + s.count, 0),
    0,
  );
  const failed = stats.problems.reduce(
    (total, problem) => total + (problem.status.find((s) => s.key === 'failed')?.count ?? 0),
    0,
  );
  // How much of this assignment a person has to mark, said the way somebody would say it.
  const handGraded = stats.problems.filter((p) => !p.autograderEnabled).length;
  const problemCount = stats.problems.length;
  const handGradedText =
    handGraded === 0
      ? null
      : handGraded === problemCount
        ? problemCount === 1
          ? 'This problem is graded by hand.'
          : `All ${problemCount} problems are graded by hand.`
        : `${handGraded} of ${problemCount} problems ${handGraded === 1 ? 'is' : 'are'} graded by hand.`;

  return (
    <div className="space-y-4">
      {heading}
      {announcer}

      {/* Context line: unit count, the normal due date, and how many participants have an
          exception. Uses the app's existing timezone-aware formatting. */}
      <div className="text-muted-foreground space-y-1 text-sm">
        <p>
          <span className="text-foreground font-medium">
            {stats.participantCount}{' '}
            {stats.participantCount === 1 ? unitPlural.slice(0, -1) : unitPlural}
          </span>{' '}
          &middot; Due {dueText} &middot; {exceptionText}
        </p>
        <p>
          Counted: enrolled, active, and assigned this work.
          {exclusionText.length > 0 ? ` Not counted: ${exclusionText.join(', ')}.` : ''}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <StatCard
          className="lg:col-span-8"
          title="Assignment score distribution"
          description={`How final assignment percentages are spread across the graded ${unitPlural}.`}
        >
          {stats.histogram.includedCount > 0 ? (
            <>
              <ScoreHistogramChart
                bins={stats.histogram.bins}
                mean={stats.histogram.mean}
                median={stats.histogram.median}
                includedCount={stats.histogram.includedCount}
                unitPlural={unitPlural}
              />
              {stats.histogram.excludedCount > 0 && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {stats.histogram.excludedCount}{' '}
                  {stats.histogram.excludedCount === 1 ? 'was' : 'were'} excluded as incomplete or
                  ungraded.
                </p>
              )}
            </>
          ) : (
            <EmptyChart message={`No fully graded ${unitPlural} yet.`} />
          )}
        </StatCard>

        <StatCard
          className="lg:col-span-4"
          title="Grading progress"
          description={
            handGradedText
              ? `What is graded and what is waiting, per problem. ${handGradedText}`
              : 'What is graded and what is waiting, per problem.'
          }
        >
          {statusTotal > 0 && stats.problems.length > 0 ? (
            <>
              <GradingProgressBar
                series={stats.problems.map((p) => ({
                  id: p.id,
                  label: p.title,
                  grading: p.grading,
                }))}
                total={statusTotal}
                unitPlural={unitPlural}
              />
              {failed > 0 && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {failed} submission{failed === 1 ? '' : 's'} could not be evaluated and can be run
                  again from the Submissions tab.
                </p>
              )}
            </>
          ) : (
            <EmptyChart
              message={
                statusTotal === 0
                  ? `No ${unitPlural} are assigned yet.`
                  : 'This assignment has no problems yet.'
              }
            />
          )}
        </StatCard>

        {/* The queue, only while something is actually in it. A permanent card here reported
            the autograder's plumbing as if it were the class's progress. */}
        {inFlight > 0 && (
          <StatCard
            className="lg:col-span-4"
            title="In the evaluation queue"
            description={`${inFlight} submission${inFlight === 1 ? '' : 's'} waiting on or running through the autograder.`}
          >
            <SubmissionStatusBar
              series={stats.problems.map((p) => ({ id: p.id, label: p.title, status: p.status }))}
              total={statusTotal}
              unitPlural={unitPlural}
            />
          </StatCard>
        )}

        <StatCard
          className="lg:col-span-8"
          title="Problem performance"
          description={`Score distribution for each problem, on a shared 0-100% scale (${unitPlural}).`}
        >
          {stats.problems.length > 0 ? (
            <ProblemBoxPlotChart problems={stats.problems} unitPlural={unitPlural} />
          ) : (
            <EmptyChart message="This assignment has no problems yet." />
          )}
        </StatCard>

        <StatCard
          className="lg:col-span-4"
          title="Submissions over time"
          description={`Submissions per day for ${unitPlural}, with the due date marked.`}
        >
          {stats.timeline.length > 0 ? (
            <SubmissionTimelineChart
              timeline={stats.timeline}
              dueDate={stats.baseDueDate}
              timeZone={stats.timezone}
              unitPlural={unitPlural}
            />
          ) : (
            <EmptyChart message="No submissions yet." />
          )}
        </StatCard>

        <StatCard
          className="lg:col-span-8"
          title="Attempts to solve"
          description={`How many submissions ${unitPlural} needed before their first correct one, per problem.`}
        >
          {stats.problems.some((p) => p.attempts.solvedCount + p.attempts.unsolvedCount > 0) ? (
            <AttemptsPerProblemChart
              problems={stats.problems.map((p) => ({
                id: p.id,
                title: p.title,
                attempts: p.attempts,
              }))}
              unitPlural={unitPlural}
            />
          ) : (
            <EmptyChart message="No submissions yet." />
          )}
        </StatCard>

        <StatCard
          className="lg:col-span-4"
          title="First-attempt success"
          description={`Share of ${unitPlural} who got each problem right on their first submission.`}
        >
          {stats.problems.length > 0 ? (
            <FirstAttemptChart
              problems={stats.problems.map((p) => ({
                id: p.id,
                title: p.title,
                correct: p.firstAttemptCorrect,
                submitted: p.firstAttemptSubmitted,
              }))}
              unitPlural={unitPlural}
            />
          ) : (
            <EmptyChart message="This assignment has no problems yet." />
          )}
        </StatCard>

        <StatCard
          className="lg:col-span-8"
          title="When submissions happen"
          description="Submission attempts by day of week and hour, in the course time zone."
        >
          {stats.heatmap.max > 0 ? (
            <ActivityHeatmapChart
              matrix={stats.heatmap.matrix}
              max={stats.heatmap.max}
              unitPlural={unitPlural}
            />
          ) : (
            <EmptyChart message="No submissions yet." />
          )}
        </StatCard>
      </div>
    </div>
  );
}
