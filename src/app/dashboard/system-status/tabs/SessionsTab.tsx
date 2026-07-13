'use client';

import React from 'react';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';
import type { SessionsStatusResponse } from '@/lib/status/types';
import { Loading, Stat, Section, useStatusQuery, copy } from '../status-ui';

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

        {data.activeSessions.length ? (
          <div className="overflow-auto rounded border">
            <table className="w-full text-sm" aria-label="Active sessions table">
              <caption className="sr-only">Active sessions seen in the last 24 hours</caption>
              <thead className="text-muted-foreground text-left text-xs">
                <tr className="border-b">
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">IP</th>
                  <th className="px-3 py-2">Last Seen</th>
                  <th className="px-3 py-2">User Agent</th>
                </tr>
              </thead>
              <tbody>
                {data.activeSessions.map((s, i) => (
                  <tr key={s.userId ?? s.email ?? i} className="border-b last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{s.email ?? s.userId ?? 'Unknown'}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span>{s.ipAddress ?? '—'}</span>
                        {s.ipAddress ? (
                          <button
                            type="button"
                            className="text-muted-foreground text-xs underline hover:opacity-80"
                            onClick={() => copy(s.ipAddress)}
                            aria-label={`Copy IP address ${s.ipAddress}`}
                          >
                            Copy
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {s.lastSeen ? formatDateTimeInTimeZone(s.lastSeen, timezone) : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-[50ch] truncate" title={s.userAgent ?? ''}>
                        {s.userAgent ?? '—'}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm">No active sessions found.</div>
        )}
      </div>
    </Section>
  );
}
