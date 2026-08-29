'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { BarChart3, ChevronDown, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone, zoneAbbrev } from '@/lib/date-format';
import type { AssignmentStatistics } from '@/lib/assignment-statistics';
import { ScoreHistogramChart } from './charts/ScoreHistogramChart';
import { SubmissionStatusBar } from './charts/SubmissionStatusBar';
import { GradingProgressBar } from './charts/GradingProgressBar';
import { TurnInStatusBar } from './charts/TurnInStatusBar';
import { ProblemBoxPlotChart } from './charts/ProblemBoxPlotChart';
import { AttemptsPerProblemChart } from './charts/AttemptsPerProblemChart';
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
  const [showHeatmap, setShowHeatmap] = useState(false);
  // Off by default, and deliberately not remembered: whether a missing submission is a zero
  // is a decision about a moment in the term, not a preference.
  const [countMissingAsZero, setCountMissingAsZero] = useState(false);

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
  /**
   * Which reading of the scores is on screen.
   *
   * The two differ only where somebody submitted nothing at all, so the switch is offered
   * only when it would change something: on an assignment everybody handed in, a control
   * that does nothing is a control that has to be understood for no reason.
   */
  const zeroed = stats.histogramCountingMissingAsZero;
  const scores = countMissingAsZero ? zeroed : stats.histogram;
  const canCountMissing = zeroed.includedCount > stats.histogram.includedCount;

  /**
   * The end-of-term question, asked rather than assumed.
   *
   * A missing submission is not a zero until somebody decides it is, so the page never makes
   * that call on its own; it offers the other reading and says which one is on screen. Work
   * that WAS submitted and is waiting on a grader is never zeroed either way: that is a
   * queue, not a mark.
   */
  const missingToggle = canCountMissing ? (
    <div className="mt-3 flex items-center gap-2">
      {/* aria-labelledby as well as the label's htmlFor. Radix renders a <button
          role="switch">, and a browser does not take a name from `for` pointing at a
          button: the control read as unnamed in Chromium while jsdom was happy with it.
          The `for` still widens the hit target to the words. */}
      <Switch
        id="count-missing-as-zero"
        aria-labelledby="count-missing-as-zero-label"
        checked={countMissingAsZero}
        onCheckedChange={setCountMissingAsZero}
      />
      <Label
        id="count-missing-as-zero-label"
        htmlFor="count-missing-as-zero"
        className="text-muted-foreground text-xs font-normal"
      >
        Count work nobody submitted as zero
      </Label>
    </div>
  ) : null;

  /** The figures the histogram already computes, said once in words. */
  const pct = (n: number) => `${Math.round(n)}%`;
  const scoreSummary = [
    `${scores.includedCount} ${countMissingAsZero ? 'counted' : 'graded'}`,
    scores.mean !== null ? `mean ${pct(scores.mean)}` : null,
    scores.median !== null ? `median ${pct(scores.median)}` : null,
    scores.low !== null && scores.high !== null
      ? `range ${pct(scores.low)} to ${pct(scores.high)}`
      : null,
  ]
    .filter(Boolean)
    .join(' \u00b7 ');

  /**
   * Why work was left out, rather than only how much.
   *
   * A histogram counts a participant only once every problem of theirs is graded, so one
   * unmarked problem can empty the whole chart. "14 excluded" reads as a fault in the page;
   * naming what they are waiting on reads as a job.
   */
  const reasons = [
    ...scores.waitingOn.slice(0, 2).map((w) => `${w.count} waiting on ${w.title}`),
    // Said differently on purpose: nobody is waiting on a grader for work that was never
    // handed in, and telling a professor they are sends them to mark nothing.
    ...scores.notSubmitted.slice(0, 2).map((w) => `${w.count} did not submit ${w.title}`),
  ];
  const exclusionNote = scores.noPossiblePoints
    ? 'This assignment has no points to award, so there is no score to chart.'
    : scores.excludedCount === 0
      ? null
      : `${scores.excludedCount} ${scores.excludedCount === 1 ? 'was' : 'were'} left out as not yet fully scored` +
        (reasons.length > 0 ? `: ${reasons.join(', ')}.` : '.');

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
          {scores.includedCount > 0 ? (
            <>
              <ScoreHistogramChart
                bins={scores.bins}
                mean={scores.mean}
                median={scores.median}
                includedCount={scores.includedCount}
                unitPlural={unitPlural}
              />
              <p className="text-muted-foreground mt-2 text-xs">{scoreSummary}</p>
              {exclusionNote && (
                <p className="text-muted-foreground mt-1 text-xs">{exclusionNote}</p>
              )}
              {missingToggle}
            </>
          ) : (
            <EmptyChart
              message={
                scores.noPossiblePoints
                  ? 'This assignment has no points to award, so there is no score to chart.'
                  : (exclusionNote ?? `No fully graded ${unitPlural} yet.`)
              }
            />
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
          title="Turn-in status"
          description={`Whether each of the ${statusTotal} ${unitPlural} met their own due date, per problem.`}
        >
          {statusTotal > 0 && stats.problems.length > 0 ? (
            <>
              <TurnInStatusBar
                series={stats.problems.map((p) => ({ id: p.id, label: p.title, turnIn: p.turnIn }))}
                total={statusTotal}
                unitPlural={unitPlural}
              />
              {stats.exceptionCount > 0 && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {stats.exceptionCount} {stats.exceptionCount === 1 ? 'is' : 'are'} measured
                  against a different due date.
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
          description={`How many submissions ${unitPlural} needed before their first correct one, per problem, with the share who got it right straight away.`}
        >
          {stats.problems.some((p) => p.attempts.solvedCount + p.attempts.unsolvedCount > 0) ? (
            <AttemptsPerProblemChart
              problems={stats.problems.map((p) => ({
                id: p.id,
                title: p.title,
                attempts: p.attempts,
                firstTry: { correct: p.firstAttemptCorrect, submitted: p.firstAttemptSubmitted },
              }))}
              unitPlural={unitPlural}
            />
          ) : (
            <EmptyChart message="No submissions yet." />
          )}
        </StatCard>

        {/* Folded away by default. When the class works is worth knowing and worth keeping,
            but it is not a decision anybody makes on this screen, and open it cost a
            screenful above the charts that are. */}
        <Card className="lg:col-span-8">
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
                Submission attempts by day of week and hour, in the course time zone.
              </CardDescription>
            </CardHeader>
            <CollapsibleContent>
              <CardContent>
                {stats.heatmap.max > 0 ? (
                  <ActivityHeatmapChart
                    matrix={stats.heatmap.matrix}
                    max={stats.heatmap.max}
                    unitPlural={unitPlural}
                  />
                ) : (
                  <EmptyChart message="No submissions yet." />
                )}
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      </div>
    </div>
  );
}
