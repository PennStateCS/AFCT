'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import type { WorkItem, WorkersStatusResponse } from '@/lib/status/workers';
import { Loading, Stat, StatGrid, StatusSection, useStatusQuery } from '../status-ui';

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

  /**
   * Announce the evaluator's state only when it changes.
   *
   * This tab refetches every fifteen seconds when auto-refresh is on. A region carrying the
   * counts would therefore repeat itself all day, which is how a screen-reader user learns to
   * switch live regions off. The health state is the thing worth interrupting for: grading has
   * stopped, or it has started again.
   */
  const health = data ? HEALTH[data.health] : null;
  const [announcement, setAnnouncement] = useState('');
  const lastHealth = useRef<string | null>(null);

  useEffect(() => {
    if (!data) return;
    if (lastHealth.current === data.health) return;
    // The first reading is the state on arrival, not a change, so it is worth saying once.
    lastHealth.current = data.health;
    setAnnouncement(`Evaluator: ${HEALTH[data.health].text}.`);
  }, [data]);

  if (isLoading || !data || !health) {
    return (
      <>
        <span role="status" aria-live="polite" className="sr-only">
          Loading evaluator status.
        </span>
        <Loading label="Loading evaluator status…" />
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* Mounted for the life of the tab, so the message it is given is announced rather than
          arriving with the element that carries it. */}
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>

      <StatusSection
        title="Evaluator"
        description="Whether submissions are being graded, and how much work is waiting."
      >
        {/* Four readings as two pairs, not one column, and not four separate cards: they are
            one picture of the evaluator. Still capped, because `Stat` puts the value at the
            far end of whatever it is given. */}
        <StatGrid>
          <Stat label="Status" value={<Badge variant={health.variant}>{health.text}</Badge>} />
          <Stat label="Grading now" value={`${data.busy} of ${data.configured} slots`} />
          <Stat label="Waiting to be graded" value={data.queue.pending} />
          <Stat label="Failed in the last hour" value={data.queue.failedLastHour} />
        </StatGrid>

        {/* The three health explanations, each at the weight its state has earned. Only
            `stalled` is actionable, so only `stalled` gets a coloured surface; `stuck`
            usually clears itself, and `idle` is normal. The role="status" stays on the
            element that carries the words either way. */}
        {data.health === 'stalled' ? (
          <div
            role="status"
            className="border-status-danger-border bg-status-danger-bg text-status-danger rounded-md border p-3 text-sm"
          >
            {data.queue.pending} submission{data.queue.pending === 1 ? ' has' : 's have'} been
            waiting {elapsed(data.oldestPendingMs ?? 0)} with nothing grading. Check that the
            evaluator container is running.
          </div>
        ) : null}

        {data.health === 'stuck' ? (
          <div
            role="status"
            className="bg-muted/40 text-muted-foreground rounded-md border p-3 text-sm"
          >
            Work below is past the evaluator timeout. The worker returns overdue submissions to the
            queue by itself, so this usually clears; the same submission appearing repeatedly points
            at one the evaluator cannot finish.
          </div>
        ) : null}

        {data.health === 'idle' ? (
          // Said carefully. An empty queue proves there is nothing to do; it says nothing about
          // whether anything is there to do it, and the page must not imply otherwise.
          <p className="text-muted-foreground text-sm">
            Nothing is queued, so there is nothing for the evaluator to pick up. A quiet queue does
            not confirm the evaluator is running: submit something to test it.
          </p>
        ) : null}
      </StatusSection>

      {/* A card, like Evaluator above it. The table's own shell paints the card colour, so
          inside a panel its border reads as a rule around the rows rather than as a second
          card, which is how the Backups table sits in System Settings. */}
      <StatusSection
        title="Being graded now"
        description="Slots are concurrent grading loops inside one evaluator container, not separate machines. How many there are comes from the submission concurrency limit in System Settings."
      >
        <DataTable
          columns={columns}
          data={data.inFlight}
          // No toolbar, same as the other status tables: a handful of rows read at a glance.
          showToolbar={false}
          emptyTitle="Nothing is being graded"
          emptyDescription="Submissions appear here while the evaluator is working on them."
        />
      </StatusSection>
    </div>
  );
}
