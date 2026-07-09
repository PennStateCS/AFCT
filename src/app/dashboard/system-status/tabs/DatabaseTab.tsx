'use client';

import React from 'react';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';
import type { DatabaseStatusResponse } from '@/lib/status/types';
import {
  Loading,
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
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const { timezone } = useEffectiveTimezone();
  const { data, isLoading } = useStatusQuery<DatabaseStatusResponse>({
    queryKey: queryKeys.admin.statusDatabase(),
    path: apiPaths.admin.statusDatabase(),
    active,
    autoRefresh,
  });

  if (isLoading || !data) {
    return <Loading />;
  }

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

  return (
    <Section title="Database">
      <div className="max-w-xl space-y-6">
        <div className="text-sm">
          <span className="text-muted-foreground">Message: </span>
          {data.message ?? '—'}
        </div>

        <div className="space-y-6">
          {details?.last_migration_name && (
            <div>
              <div className="text-muted-foreground mb-2 text-sm font-semibold">Last Migration</div>
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

          {pg && (
            <div>
              <div className="text-muted-foreground mb-2 text-sm font-semibold">
                Performance (Postgres)
              </div>
              <div className="space-y-2">
                {pg.cache_hit_ratio != null && (
                  <Stat label="Cache Hit Ratio" value={`${pg.cache_hit_ratio}%`} />
                )}
                {pg.num_backends != null && <Stat label="Connections" value={pg.num_backends} />}
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
        </div>
      </div>
    </Section>
  );
}
