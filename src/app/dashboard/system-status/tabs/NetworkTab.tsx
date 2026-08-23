'use client';

import React from 'react';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import type { NetworkStatusResponse } from '@/lib/status/types';
import { Loading, Stat, StatGrid, Section, useStatusQuery } from '../status-ui';
import { formatMs, formatRate } from '../status-format';

export default function NetworkTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const { data: net, isLoading } = useStatusQuery<NetworkStatusResponse>({
    queryKey: queryKeys.admin.statusNetwork(),
    path: apiPaths.admin.statusNetwork(),
    active,
    autoRefresh,
  });

  if (isLoading || !net) {
    return <Loading />;
  }

  const errRate = (e?: { errors?: number; total?: number; ratePct?: number }) =>
    e ? `${e.errors ?? 0}/${e.total ?? 0} (${formatRate(e.ratePct ?? 0)})` : '—';

  const host = (e?: { host?: string | null; port?: number | null }) =>
    e?.host ? `${e.host}:${e.port ?? ''}` : '—';
  const dns = (e?: { resolved?: string[] | null }) =>
    e?.resolved?.length ? e.resolved.join(', ') : '—';

  return (
    <Section title="Network">
      {/* Two endpoints, side by side rather than interleaved down one column.
          The nine readings here are really the same four questions asked twice, and the
          answers only mean anything against each other: a slow database and a slow sign-in
          endpoint is the network, one of them alone is that service. Stacked they were nine
          unrelated rows and you had to hold one to compare it with the next. */}
      <div className="max-w-5xl space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="text-muted-foreground mb-2 text-sm font-semibold">
              Database endpoint
            </div>
            <div className="space-y-2">
              <Stat label="Latency" value={formatMs(net.db?.latencyMs)} />
              <Stat
                label="Connections"
                value={typeof net.db?.connections === 'number' ? String(net.db.connections) : '—'}
              />
              <Stat label="Host" value={host(net.db)} />
              <Stat label="DNS" value={dns(net.db)} />
            </div>
          </div>

          <div>
            <div className="text-muted-foreground mb-2 text-sm font-semibold">
              Authentication endpoint
            </div>
            <div className="space-y-2">
              <Stat label="Latency" value={formatMs(net.auth?.latencyMs)} />
              <Stat label="Host" value={host(net.auth)} />
              <Stat label="DNS" value={dns(net.auth)} />
            </div>
          </div>
        </div>

        <div>
          <div className="text-muted-foreground mb-2 text-sm font-semibold">Error rates</div>
          <StatGrid className="max-w-4xl">
            <Stat label="Last 5 minutes" value={errRate(net.errors?.last5m)} />
            <Stat label="Last 15 minutes" value={errRate(net.errors?.last15m)} />
          </StatGrid>
        </div>
      </div>
    </Section>
  );
}
