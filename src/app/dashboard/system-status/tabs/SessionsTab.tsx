'use client';

import React, { useMemo } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date-format';
import { DataTable } from '@/components/ui/data-table';
import type { SessionsStatusResponse } from '@/lib/status/types';
import { Loading, Stat, Section, useStatusQuery, copy } from '../status-ui';

type SessionRow = SessionsStatusResponse['activeSessions'][number];

export default function SessionsTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const { timezone } = useEffectiveTimezone();
  const { data, isLoading } = useStatusQuery<SessionsStatusResponse>({
    queryKey: queryKeys.admin.statusSessions(),
    path: apiPaths.admin.statusSessions(),
    active,
    autoRefresh,
  });

  const columns = useMemo<ColumnDef<SessionRow>[]>(
    () => [
      {
        id: 'user',
        header: 'User',
        accessorFn: (s) => s.email ?? s.userId ?? 'Unknown',
        cell: ({ row }) => (
          <span className="font-medium">
            {row.original.email ?? row.original.userId ?? 'Unknown'}
          </span>
        ),
        meta: { priority: 1 },
      },
      {
        id: 'ip',
        header: 'IP',
        accessorFn: (s) => s.ipAddress ?? '',
        cell: ({ row }) => {
          const ip = row.original.ipAddress;
          if (!ip) return '—';
          return (
            <div className="flex items-center gap-2">
              <span>{ip}</span>
              <button
                type="button"
                className="text-muted-foreground text-xs underline hover:opacity-80"
                onClick={() => copy(ip)}
                aria-label={`Copy IP address ${ip}`}
              >
                Copy
              </button>
            </div>
          );
        },
        meta: { priority: 1 },
      },
      {
        accessorKey: 'lastSeen',
        header: 'Last Seen',
        cell: ({ row }) =>
          row.original.lastSeen ? formatDateTimeInTimeZone(row.original.lastSeen, timezone) : '—',
        meta: { priority: 2 },
      },
      {
        accessorKey: 'userAgent',
        header: 'User Agent',
        cell: ({ row }) => (
          // Truncated in the table, where the column has to stay a sane width and the
          // title attribute gives the rest. Below sm the row is a card with no hover to
          // reveal a title, so let it wrap and show the whole string.
          <div
            className="max-w-[50ch] truncate max-sm:break-words max-sm:whitespace-normal"
            title={row.original.userAgent ?? ''}
          >
            {row.original.userAgent ?? '—'}
          </div>
        ),
        enableSorting: false,
        meta: { priority: 3 },
      },
    ],
    [timezone],
  );

  if (isLoading || !data) {
    return <Loading />;
  }

  const summary = data.summary;

  return (
    <Section title="Sessions">
      <div className="space-y-6">
        <div className="max-w-xl space-y-2">
          <Stat label="Total (24h)" value={summary.total24h} />
          <Stat label="Unique users" value={summary.uniqUsers24h} />
          <Stat label="Last 5m" value={summary.last5m} />
          <Stat label="Last 15m" value={summary.last15m} />
          <Stat label="Last 60m" value={summary.last60m} />
        </div>

        <DataTable
          columns={columns}
          data={data.activeSessions}
          storageKey="status-sessions"
          tableLabel="Active sessions table"
          // No toolbar. It is a short list read at a glance, and dropping it takes the CSV
          // export with it, which is no loss: these rows carry IPs and user agents and were
          // never something to offer for download casually.
          showToolbar={false}
          defaultSorting={[{ id: 'lastSeen', desc: true }]}
          emptyTitle="No active sessions"
          emptyDescription="No sessions have been seen in the last 24 hours."
        />
      </div>
    </Section>
  );
}
