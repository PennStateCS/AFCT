'use client';

import React, { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import type { WorkItem, WorkersStatusResponse } from '@/lib/status/workers';
import { Loading, Stat, Section, useStatusQuery } from '../status-ui';

/** How long something has been running, in the shortest form that is still honest. */
function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const HEALTH = {
  working: { text: 'Grading', variant: 'info' as const },
  idle: { text: 'Nothing queued', variant: 'neutral' as const },
  stalled: { text: 'Not being collected', variant: 'danger' as const },
  stuck: { text: 'Work overdue', variant: 'warning' as const },
};

export default function WorkersTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const { data, isLoading } = useStatusQuery<WorkersStatusResponse>({
    queryKey: queryKeys.admin.statusWorkers(),
    path: apiPaths.admin.statusWorkers(),
    active,
    autoRefresh,
  });

  const columns = useMemo<ColumnDef<WorkItem>[]>(
    () => [
      {
        id: 'problem',
        header: 'Problem type',
        accessorFn: (w) => w.problemType ?? '',
        cell: ({ row }) => (
          <span className="font-medium">{row.original.problemType ?? 'Problem'}</span>
        ),
        meta: { priority: 1 },
      },
      {
        id: 'runningFor',
        header: 'Running for',
        accessorFn: (w) => w.runningForMs,
        cell: ({ row }) => elapsed(row.original.runningForMs),
        meta: { priority: 1 },
      },
      {
        id: 'state',
        header: 'State',
        accessorFn: (w) => (w.stuck ? 'overdue' : 'grading'),
        cell: ({ row }) =>
          row.original.stuck ? (
            <Badge variant="warning">Overdue</Badge>
          ) : (
            <Badge variant="info">Grading</Badge>
          ),
        meta: { priority: 1 },
      },
      {
        id: 'submissionId',
        header: 'Submission',
        accessorFn: (w) => w.submissionId,
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.submissionId}</span>,
        meta: { priority: 3 },
      },
    ],
    [],
  );

  if (isLoading || !data) return <Loading label="Loading evaluator status…" />;

  const health = HEALTH[data.health];

  return (
    <div className="space-y-6">
      <Section title="Evaluator">
        {/* Capped like every other status tab: full-width rows put each value an inch from
            the right edge of the display, a long way from the label it belongs to. */}
        <div className="max-w-xl space-y-2">
          <Stat label="Status" value={<Badge variant={health.variant}>{health.text}</Badge>} />
          <Stat label="Grading now" value={`${data.busy} of ${data.configured} slots`} />
          <Stat label="Waiting to be graded" value={data.queue.pending} />
          <Stat label="Failed in the last hour" value={data.queue.failedLastHour} />
        </div>

        {data.health === 'stalled' ? (
          <p role="status" className="text-destructive max-w-xl text-sm">
            {data.queue.pending} submission{data.queue.pending === 1 ? ' has' : 's have'} been
            waiting {elapsed(data.oldestPendingMs ?? 0)} with nothing grading. Check that the
            evaluator container is running.
          </p>
        ) : null}

        {data.health === 'stuck' ? (
          <p role="status" className="text-muted-foreground max-w-xl text-sm">
            Work below is past the evaluator timeout. The worker returns overdue submissions to
            the queue by itself, so this usually clears; the same submission appearing repeatedly
            points at one the evaluator cannot finish.
          </p>
        ) : null}

        {data.health === 'idle' ? (
          // Said carefully. An empty queue proves there is nothing to do; it says nothing about
          // whether anything is there to do it, and the page must not imply otherwise.
          <p className="text-muted-foreground max-w-xl text-sm">
            Nothing is queued, so there is nothing for the evaluator to pick up. A quiet queue
            does not confirm the evaluator is running: submit something to test it.
          </p>
        ) : null}
      </Section>

      <Section title="Being graded now">
        <p className="text-muted-foreground max-w-3xl text-sm">
          Slots are concurrent grading loops inside one evaluator container, not separate
          machines. How many there are comes from the submission concurrency limit in System
          Settings.
        </p>
        <DataTable
          columns={columns}
          data={data.inFlight}
          // No toolbar, same as the other status tables: a handful of rows read at a glance.
          showToolbar={false}
          emptyTitle="Nothing is being graded"
          emptyDescription="Submissions appear here while the evaluator is working on them."
        />
      </Section>
    </div>
  );
}
