'use client';

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';
import type { DatabaseStatusResponse } from '@/lib/status/types';
import {
  Skel,
  Stat,
  Section,
  useStatusQuery,
  formatDbSize,
  formatDbVersion,
  copy,
} from '../status-ui';

export default function DatabaseTab({
  active,
  autoRefresh,
  deep,
  setDeep,
}: {
  active: boolean;
  autoRefresh: boolean;
  deep: boolean;
  setDeep: (v: boolean) => void;
}) {
  const { timezone } = useEffectiveTimezone();
  const { data, isLoading } = useStatusQuery<DatabaseStatusResponse>({
    queryKey: queryKeys.admin.statusDatabase(deep),
    path: apiPaths.admin.statusDatabase({ deep }),
    active,
    autoRefresh,
  });

  const ok = data?.ok ?? false;
  const details = data?.details;
  const pg = data?.stats?.pg;
  const sqlite = data?.stats?.sqlite;

  const dbSizeBytes =
    details?.pg_database_size_bytes ??
    details?.sqlite_approx_file_bytes ??
    details?.sqlite_file_bytes ??
    null;
  const tables =
    typeof details?.table_count === 'number' && details.table_count > 0
      ? details.table_count
      : null;

  const action = (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">Deep</span>
        <Switch checked={deep} onCheckedChange={setDeep} aria-label="Enable deep database probes" />
      </div>
      {data ? <Badge variant={ok ? 'success' : 'danger'}>{ok ? 'OK' : 'DOWN'}</Badge> : null}
    </div>
  );

  return (
    <Section title="Database" action={action}>
      {isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skel w="w-40" />
          <Skel w="w-32" />
          <Skel w="w-28" />
        </div>
      ) : (
        <>
          <div className="text-sm">
            <span className="text-muted-foreground">Message: </span>
            {data.message ?? '—'}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              {details?.last_migration_name && (
                <div>
                  <div className="text-muted-foreground mb-2 text-sm font-semibold">
                    Last Migration
                  </div>
                  <div className="space-y-2">
                    <Stat
                      label="Name"
                      value={details.last_migration_name}
                      onCopy={() => copy(details.last_migration_name)}
                    />
                    <Stat
                      label="Finished At"
                      value={
                        details.last_migration_finished_at
                          ? formatDateTimeInTimeZone(
                              new Date(details.last_migration_finished_at),
                              timezone,
                            )
                          : '—'
                      }
                    />
                  </div>
                </div>
              )}

              <div>
                <div className="text-muted-foreground mb-2 text-sm font-semibold">Details</div>
                <div className="space-y-2">
                  <Stat label="Provider" value={(data.provider ?? 'unknown').toUpperCase()} />
                  {details?.version && (
                    <Stat label="Version" value={formatDbVersion(details.version)} />
                  )}
                  {details?.sqlite_version && (
                    <Stat label="SQLite Version" value={details.sqlite_version} />
                  )}
                  {details?.current_time_iso && (
                    <Stat
                      label="DB Time"
                      value={formatDateTimeInTimeZone(details.current_time_iso, timezone)}
                    />
                  )}
                  {details?.current_database && (
                    <Stat label="DB Name" value={details.current_database} />
                  )}
                  <Stat label="Tables" value={tables == null ? '—' : tables} />
                  <Stat label="DB Size" value={formatDbSize(dbSizeBytes)} />
                  {details?.sqlite_file_path && (
                    <Stat
                      label="SQLite file"
                      value={details.sqlite_file_path}
                      onCopy={() => copy(details.sqlite_file_path)}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {pg && (
                <div>
                  <div className="text-muted-foreground mb-2 text-sm font-semibold">
                    Performance (Postgres)
                  </div>
                  <div className="space-y-2">
                    {pg.cache_hit_ratio != null && (
                      <Stat label="Cache Hit Ratio" value={`${pg.cache_hit_ratio}%`} />
                    )}
                    {pg.num_backends != null && (
                      <Stat label="Connections" value={pg.num_backends} />
                    )}
                    {pg.seq_scans != null && <Stat label="Sequential Scans" value={pg.seq_scans} />}
                    {pg.idx_scans != null && <Stat label="Index Scans" value={pg.idx_scans} />}
                    {pg.transactions_per_sec != null && (
                      <Stat label="Transactions/sec" value={pg.transactions_per_sec} />
                    )}
                    {pg.slow_query_count != null && (
                      <Stat label="Slow Queries (>5s)" value={pg.slow_query_count} />
                    )}
                  </div>
                </div>
              )}

              {sqlite && (
                <div>
                  <div className="text-muted-foreground mb-2 text-sm font-semibold">
                    Performance (SQLite)
                  </div>
                  <div className="space-y-2">
                    <Stat label="Journal Mode" value={sqlite.journal_mode ?? '—'} />
                  </div>
                </div>
              )}

              {deep && pg?.top_queries?.length ? (
                <div>
                  <div className="text-muted-foreground mb-2 text-sm font-semibold">
                    Top Queries
                  </div>
                  <ul className="space-y-1 text-xs">
                    {pg.top_queries.map((q, i) => (
                      <li key={`${q.pid}-${i}`} className="rounded border p-2">
                        <span className="text-muted-foreground">
                          pid {q.pid} · {q.state ?? '—'} · {q.age_ms}ms
                        </span>
                        <div className="break-all">{q.query_trunc}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </Section>
  );
}
