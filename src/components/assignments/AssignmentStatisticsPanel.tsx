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
import { formatDateTimeInTimeZone, zoneAbbrev } from '@/lib/date';
import type { AssignmentStatistics } from '@/lib/assignment-statistics';
import { ScoreHistogramChart } from './charts/ScoreHistogramChart';
import { SubmissionStatusBar } from './charts/SubmissionStatusBar';
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
    <h2 role="heading" aria-level={2} className="flex items-center gap-2 text-2xl font-semibold">
      <BarChart3 className="h-6 w-6" />
      Statistics
    </h2>
  );

  if (query.isPending) {
    return (
      <div className="space-y-4">
        {heading}
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
          <span>Could not load statistics for this assignment. Try refreshing the page.</span>
        </div>
      </div>
    );
  }

  const stats = query.data;
  const unitPlural = stats.unit === 'group' ? 'groups' : 'students';
  const statusTotal = stats.participantCount;

  const dueText = `${formatDateTimeInTimeZone(stats.baseDueDate, stats.timezone, hour12)} ${zoneAbbrev(
    stats.baseDueDate,
    stats.timezone,
  )}`.trim();
  const exceptionText = `${stats.exceptionCount} due-date exception${stats.exceptionCount === 1 ? '' : 's'}`;

  return (
    <div className="space-y-4">
      {heading}

      {/* Context line: unit count, the normal due date, and how many participants have an
          exception. Uses the app's existing timezone-aware formatting. */}
      <p className="text-muted-foreground text-sm">
        <span className="text-foreground font-medium">
          {stats.participantCount} {stats.participantCount === 1 ? unitPlural.slice(0, -1) : unitPlural}
        </span>{' '}
        &middot; Due {dueText} &middot; {exceptionText}
      </p>

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
                  {stats.histogram.excludedCount} {stats.histogram.excludedCount === 1 ? 'was' : 'were'}{' '}
                  excluded as incomplete or ungraded.
                </p>
              )}
            </>
          ) : (
            <EmptyChart message={`No fully graded ${unitPlural} yet.`} />
          )}
        </StatCard>

        <StatCard
          className="lg:col-span-4"
          title="Submission status"
          description={`For each problem, the evaluation state of each of the ${statusTotal} ${unitPlural}' latest submission.`}
        >
          {statusTotal > 0 && stats.problems.length > 0 ? (
            <SubmissionStatusBar
              series={stats.problems.map((p) => ({ id: p.id, label: p.title, status: p.status }))}
              total={statusTotal}
              unitPlural={unitPlural}
            />
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
          description={`How many submissions ${unitPlural} needed before their first correct one, per problem.`}
        >
          {stats.problems.some(
            (p) => p.attempts.solvedCount + p.attempts.unsolvedCount > 0,
          ) ? (
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
