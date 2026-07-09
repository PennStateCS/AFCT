'use client';

import React from 'react';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatDateTimeInTimeZone } from '@/lib/date';
import type { NetworkStatusResponse } from '@/lib/status/types';
import { Skel, Stat, Section, useStatusQuery, formatMs, formatRate } from '../status-ui';

export default function NetworkTab({
  active,
  autoRefresh,
}: {
  active: boolean;
  autoRefresh: boolean;
}) {
  const { timezone } = useEffectiveTimezone();
  const { data: net, isLoading } = useStatusQuery<NetworkStatusResponse>({
    queryKey: queryKeys.admin.statusNetwork(),
    path: apiPaths.admin.statusNetwork(),
    active,
    autoRefresh,
  });

  if (isLoading || !net) {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Skel w="w-40" />
        <Skel w="w-32" />
      </div>
    );
  }

  const errRate = (e?: { errors?: number; total?: number; ratePct?: number }) =>
    e ? `${e.errors ?? 0}/${e.total ?? 0} (${formatRate(e.ratePct ?? 0)})` : '—';

  return (
    <Section title="Network">
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Stat label="DB Latency" value={formatMs(net.db?.latencyMs)} />
        <Stat label="Auth Latency" value={formatMs(net.auth?.latencyMs)} />
        <Stat
          label="DB Connections"
          value={typeof net.db?.connections === 'number' ? String(net.db.connections) : '—'}
        />
        <Stat
          label="SSL cert expiry"
          value={net.auth?.sslExpiry ? formatDateTimeInTimeZone(net.auth.sslExpiry, timezone) : '—'}
        />
        <Stat label="Error rate (5m)" value={errRate(net.errors?.last5m)} />
        <Stat label="Error rate (15m)" value={errRate(net.errors?.last15m)} />
        <Stat label="DB DNS" value={net.db?.resolved?.length ? net.db.resolved.join(', ') : '—'} />
        <Stat
          label="Auth DNS"
          value={net.auth?.resolved?.length ? net.auth.resolved.join(', ') : '—'}
        />
        <Stat label="DB Host" value={net.db?.host ? `${net.db.host}:${net.db.port ?? ''}` : '—'} />
        <Stat
          label="Auth Host"
          value={net.auth?.host ? `${net.auth.host}:${net.auth.port ?? ''}` : '—'}
        />
      </div>
    </Section>
  );
}
