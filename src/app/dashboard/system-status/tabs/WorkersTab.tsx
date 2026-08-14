'use client';

import React, { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { DataTable } from '@/components/ui/data-table';
import { Badge } from '@/components/ui/badge';
import type { WorkerSlotItem, WorkersStatusResponse } from '@/lib/status/workers';
import { Loading, Stat, Section, useStatusQuery } from '../status-ui';

/** How long something has been running, in the shortest form that is still honest. */
function elapsed(ms: number | null): string {
  if (ms === null) return '';
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const STATE_LABEL: Record<WorkerSlotItem['state'], { text: string; variant: 'success' | 'info' | 'danger' }> = {
  grading: { text: 'Grading', variant: 'info' },
  waiting: { text: 'Waiting', variant: 'success' },
  // Not "failed": the slot may be perfectly fine and merely unable to reach the database.
  // What is true is that it has stopped saying so.
  stale: { text: 'Not reporting', variant: 'danger' },
};

export default function WorkersTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const { timezone } = useEffectiveTimezone();
  const { data, isLoading } = useStatusQuery<WorkersStatusResponse>({
    queryKey: queryKeys.admin.statusWorkers(),
    path: apiPaths.admin.statusWorkers(),
    active,
    autoRefresh,
  });

  const columns = useMemo<ColumnDef<WorkerSlotItem>[]>(
    () => [
      {
        id: 'slot',
        header: 'Slot',
        accessorFn: (s) => s.position,
        cell: ({ row }) => <span className="font-medium">Slot {row.original.position}</span>,
        meta: { priority: 1 },
      },
      {
        id: 'state',
        header: 'State',
        accessorFn: (s) => s.state,
        cell: ({ row }) => {
          const s = STATE_LABEL[row.original.state];
          return <Badge variant={s.variant}>{s.text}</Badge>;
        },
        meta: { priority: 1 },
      },
      {
        id: 'work',
        header: 'Working on',
        accessorFn: (s) => s.problemType ?? '',
        cell: ({ row }) => {
          const s = row.original;
          if (s.state !== 'grading') return <span className="text-muted-foreground">Nothing</span>;
          // The kind of problem and how long, never whose it is.
          return (
            <span>
              {s.problemType ?? 'Problem'}
              <span className="text-muted-foreground"> for {elapsed(s.busySinceMs)}</span>
            </span>
          );
        },
        meta: { priority: 1 },
      },
      {
        id: 'lastSeen',
        header: 'Last reported',
        accessorFn: (s) => s.lastSeenAt,
        cell: ({ row }) => formatDateTimeInTimeZone(row.original.lastSeenAt, timezone),
        meta: { priority: 2 },
      },
      {
        id: 'startedAt',
        header: 'Started',
        accessorFn: (s) => s.startedAt,
        cell: ({ row }) => formatDateTimeInTimeZone(row.original.startedAt, timezone),
        meta: { priority: 3 },
      },
    ],
    [timezone],
  );

  if (isLoading || !data) return <Loading label="Loading worker status…" />;

  const health =
    data.health === 'healthy'
      ? { text: 'Healthy', variant: 'success' as const }
      : data.health === 'degraded'
        ? { text: 'Degraded', variant: 'warning' as const }
        : { text: 'Not running', variant: 'danger' as const };

  return (
    <div className="space-y-6">
      <Section title="Evaluator">
        <div className="space-y-2">
          <Stat label="Status" value={<Badge variant={health.variant}>{health.text}</Badge>} />
          <Stat label="Slots reporting" value={`${data.live} of ${data.configured}`} />
          <Stat label="Grading now" value={data.grading} />
          <Stat label="Waiting to be graded" value={data.queue.pending} />
          <Stat label="Failed in the last hour" value={data.queue.failedLastHour} />
        </div>

        {data.backlogWithNoWorkers ? (
          // The case this page exists for: work queued and nothing collecting it.
          <p role="status" className="text-destructive text-sm">
            Submissions are waiting and no slot is reporting. Grading has stopped; check that the
            evaluator container is running.
          </p>
        ) : null}

        {data.health === 'degraded' ? (
          <p role="status" className="text-muted-foreground text-sm">
            Fewer slots are reporting than the {data.configured} configured. Lowering the limit
            retires slots as they finish, so this is expected for a short while after a change.
          </p>
        ) : null}
      </Section>

      <Section title="Slots">
        <p className="text-muted-foreground text-sm">
          Slots are concurrent grading loops inside one evaluator container, not separate machines.
          The number comes from the submission concurrency limit in System Settings.
        </p>
        <DataTable
          columns={columns}
          data={data.slots}
          emptyTitle="No slot is reporting"
          emptyDescription="The evaluator container may be stopped, or unable to reach the database."
        />
      </Section>
    </div>
  );
}
