'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatTimeInTimeZone } from '@/lib/date';
import type { SummaryStatus } from '@/lib/status/types';
import {
  Skel,
  TrendBadge,
  useTrends,
  formatUptime,
  formatDbSize,
  type HistoryPoint,
} from './status-ui';
import ServerTab from './tabs/ServerTab';
import DatabaseTab from './tabs/DatabaseTab';
import DockerTab from './tabs/DockerTab';
import NetworkTab from './tabs/NetworkTab';
import SessionsTab from './tabs/SessionsTab';
import FilesTab from './tabs/FilesTab';

const TABS = [
  { value: 'server', label: 'Server' },
  { value: 'database', label: 'Database' },
  { value: 'docker', label: 'Docker' },
  { value: 'network', label: 'Network' },
  { value: 'sessions', label: 'Session' },
  { value: 'files', label: 'Files' },
] as const;

export default function SystemStatusClient() {
  const { timezone } = useEffectiveTimezone();
  const queryClient = useQueryClient();
  const [autoRefresh, setAutoRefresh] = useState(false);
  // Persist the open tab so a refresh keeps you where you were (SSR-safe init).
  const [tab, setTabState] = useState<string>(() => {
    if (typeof window === 'undefined') return 'server';
    const saved = window.localStorage.getItem('afct.systemStatusTab');
    return saved && TABS.some((t) => t.value === saved) ? saved : 'server';
  });
  const setTab = (v: string) => {
    setTabState(v);
    try {
      window.localStorage.setItem('afct.systemStatusTab', v);
    } catch {
      /* ignore disabled storage */
    }
  };

  // Fast top-card summary — always loaded; the per-tab detail is fetched lazily.
  const {
    data: summary,
    isFetching,
    dataUpdatedAt,
  } = useQuery({
    queryKey: queryKeys.admin.statusSummary(),
    queryFn: () => fetchJson<SummaryStatus>(apiPaths.admin.statusSummary()),
    refetchInterval: autoRefresh ? 15_000 : false,
    staleTime: 15_000,
  });

  const sample: HistoryPoint | null = useMemo(
    () =>
      summary
        ? {
            ts: Date.now(),
            cpuPct: summary.procCpuPct,
            memPct: summary.procMemPct,
            dbSizeMB: summary.dbSizeBytes
              ? Math.round(summary.dbSizeBytes / 1024 / 1024)
              : undefined,
            dbTables: summary.dbTables,
            sessions24h: summary.sessions24h,
            latencyMs: summary.latencyMs,
          }
        : null,
    [summary],
  );
  const { windowHours, setHours, trends } = useTrends(sample);

  const dbOk = summary?.db.ok ?? false;
  const provider = summary?.db.provider ?? 'unknown';
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  const tiles = useMemo(
    () => [
      { label: 'Uptime', value: formatUptime(summary?.uptime), delta: 0 },
      { label: 'Proc CPU', value: `${Math.round(summary?.procCpuPct ?? 0)}%`, delta: trends.cpu },
      { label: 'Proc Mem', value: `${(summary?.procMemPct ?? 0).toFixed(1)}%`, delta: trends.mem },
      {
        label: 'DB Tables',
        value: summary?.dbTables == null ? '—' : String(summary.dbTables),
        delta: trends.dbTables,
      },
      { label: 'DB Size', value: formatDbSize(summary?.dbSizeBytes), delta: trends.dbSize },
      { label: 'Sessions (24h)', value: String(summary?.sessions24h ?? 0), delta: trends.sessions },
      { label: 'Unique Users', value: String(summary?.uniqueUsers24h ?? 0), delta: 0 },
      { label: 'Latency (ms)', value: String(summary?.latencyMs ?? '—'), delta: trends.latency },
    ],
    [summary, trends],
  );

  // Refresh both the summary and whichever tab is currently open.
  const refreshAll = () => queryClient.invalidateQueries({ queryKey: ['admin', 'status'] });

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4 pb-8">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <CardTitle role="heading" aria-level={1} className="text-2xl">
              System Status
            </CardTitle>
            <Badge variant={dbOk ? 'success' : 'danger'} title={summary?.db.message || ''}>
              DB {dbOk ? 'OK' : 'DOWN'}
            </Badge>
            <Badge variant="info" title="Database provider">
              {provider.toUpperCase()}
            </Badge>
            {typeof summary?.latencyMs === 'number' && (
              <Badge variant="warning" title="Summary latency">
                {summary.latencyMs} ms
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm">Auto-refresh</span>
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                aria-label="Enable automatic refresh every 15 seconds"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">Trend window</span>
              <select
                aria-label="Select trend window"
                className="bg-background rounded border px-2 py-1 text-sm"
                value={windowHours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                <option value={1}>1h</option>
                <option value={6}>6h</option>
                <option value={24}>24h</option>
              </select>
            </div>
            <div className="text-muted-foreground text-xs" aria-live="polite">
              {lastUpdated ? `Updated ${formatTimeInTimeZone(lastUpdated, timezone)}` : ''}
            </div>
            <Button size="sm" onClick={refreshAll} disabled={isFetching}>
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pb-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {tiles.map((t) => (
              <div key={t.label} className="rounded border p-3">
                <div className="text-muted-foreground text-xs">{t.label}</div>
                <div className="mt-1 flex h-7 items-center text-lg font-semibold">
                  {!summary ? (
                    <Skel w="w-16" />
                  ) : (
                    <>
                      {t.value}
                      <TrendBadge delta={t.delta} />
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          <TabsList
            aria-label="System status sections"
            className="bg-card border-border h-12 w-full justify-start gap-1 overflow-x-auto rounded-md border p-1 shadow-sm"
          >
            {TABS.map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="hover:bg-accent data-[state=active]:bg-secondary px-4 whitespace-nowrap data-[state=active]:text-white"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="pt-2">
            <TabsContent value="server">
              <ServerTab
                active={tab === 'server'}
                autoRefresh={autoRefresh}
                windowHours={windowHours}
              />
            </TabsContent>
            <TabsContent value="database">
              <DatabaseTab active={tab === 'database'} autoRefresh={autoRefresh} />
            </TabsContent>
            <TabsContent value="docker">
              <DockerTab active={tab === 'docker'} autoRefresh={autoRefresh} />
            </TabsContent>
            <TabsContent value="network">
              <NetworkTab active={tab === 'network'} autoRefresh={autoRefresh} />
            </TabsContent>
            <TabsContent value="sessions">
              <SessionsTab active={tab === 'sessions'} autoRefresh={autoRefresh} />
            </TabsContent>
            <TabsContent value="files">
              <FilesTab active={tab === 'files'} autoRefresh={autoRefresh} />
            </TabsContent>
          </div>
        </CardContent>
      </Card>
    </Tabs>
  );
}
