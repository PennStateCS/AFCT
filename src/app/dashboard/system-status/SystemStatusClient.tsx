'use client';

import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchJson } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TabBar, TabRail } from '@/components/course/course-tabs';
import { useIsDesktopNav } from '@/hooks/use-desktop-nav';
import {
  Server,
  Database,
  Container,
  Network,
  Users,
  HardDrive,
  ShieldAlert,
  Cpu,
} from 'lucide-react';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import { useEffectiveTimezone } from '@/hooks/use-effective-timezone';
import { formatTimeInTimeZone } from '@/lib/date-format';
import type { SummaryStatus } from '@/lib/status/types';
import { hostNotices } from './host-notices';
import { Skel, TrendBadge } from './status-ui';
import { formatUptime, formatDbSize } from './status-format';
import { useTrends, type HistoryPoint } from './use-trends';
import ServerTab from './tabs/ServerTab';
import DatabaseTab from './tabs/DatabaseTab';
import DockerTab from './tabs/DockerTab';
import NetworkTab from './tabs/NetworkTab';
import SessionsTab from './tabs/SessionsTab';
import FilesTab from './tabs/FilesTab';
import RateLimitsTab from './tabs/RateLimitsTab';
import WorkersTab from './tabs/WorkersTab';

const TABS = [
  { value: 'server', label: 'Server', icon: Server },
  { value: 'database', label: 'Database', icon: Database },
  { value: 'docker', label: 'Docker', icon: Container },
  { value: 'network', label: 'Network', icon: Network },
  { value: 'sessions', label: 'Session', icon: Users },
  { value: 'files', label: 'Files', icon: HardDrive },
  { value: 'rate-limits', label: 'Rate Limits', icon: ShieldAlert },
  { value: 'workers', label: 'Workers', icon: Cpu },
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

  // Fast top-card summary, always loaded; the per-tab detail is fetched lazily.
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
  // Only the things worth acting on: a pending restart, waiting security updates, a clock
  // that has drifted. Nothing appears when AFCT has no report, since it cannot say either way.
  const hostWarnings = summary?.host
    ? hostNotices(summary.host).filter((n) => n.tone === 'warn').length
    : 0;
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

  const statusTabs = TABS.map((t) => ({ value: t.value, label: t.label, Icon: t.icon }));

  // xl rather than lg: metric grids and charts beside a rail need the room.
  const railNav = useIsDesktopNav(1280);

  // Refresh both the summary and whichever tab is currently open.
  const refreshAll = () => queryClient.invalidateQueries({ queryKey: ['admin', 'status'] });

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      orientation={railNav ? 'vertical' : 'horizontal'}
      className="space-y-4"
    >
      {/* Heading, health badges, refresh controls and the metric tiles all sit on the
          workspace itself: the page-sized card put a dashboard inside a card. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">System Status</h1>
            <Badge variant={dbOk ? 'success' : 'danger'} title={summary?.db.message || ''}>
              DB {dbOk ? 'OK' : 'DOWN'}
              {summary?.db.message ? (
                <span className="sr-only"> ({summary.db.message})</span>
              ) : null}
            </Badge>
            <Badge variant="info" title="Database provider">
              <span className="sr-only">Database provider: </span>
              {provider.toUpperCase()}
            </Badge>
            {hostWarnings > 0 && (
              <Badge
                variant="danger"
                title="The server itself needs attention. See the Server tab."
              >
                Server needs attention
              </Badge>
            )}
            {typeof summary?.latencyMs === 'number' && (
              <Badge variant="warning" title="Summary latency">
                <span className="sr-only">Summary latency: </span>
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
                className="bg-card border-input rounded border px-2 py-1 text-sm"
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
      </div>

      {/* Eight across only from xl. At lg they were 128px wide and the values wrapped. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-8">
        {tiles.map((t) => (
          <div key={t.label} className="bg-card rounded-lg border p-3">
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

      {/* Eight sections is too many for a strip, so above xl they become a rail beside the
          panels. Below that the strip and its select stay as they were. One control at a
          time: two tablists under one Tabs root would duplicate its ARIA wiring. */}
      <div className="space-y-4 xl:grid xl:grid-cols-[12rem_minmax(0,1fr)] xl:items-start xl:gap-6 xl:space-y-0">
        {railNav ? (
          <TabRail tabs={statusTabs} ariaLabel="System status sections" />
        ) : (
          <TabBar
            ariaLabel="System status sections"
            selectId="system-status-tab-select"
            value={tab}
            onValueChange={setTab}
            tabs={statusTabs}
          />
        )}

        {/* No max width, unlike System Settings: this page is metric grids, charts and
            tables, all of which want the room. */}
        <div className="min-w-0">
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
            <TabsContent value="rate-limits">
              <RateLimitsTab active={tab === 'rate-limits'} autoRefresh={autoRefresh} />
            </TabsContent>
            <TabsContent value="workers">
              <WorkersTab active={tab === 'workers'} autoRefresh={autoRefresh} />
            </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
