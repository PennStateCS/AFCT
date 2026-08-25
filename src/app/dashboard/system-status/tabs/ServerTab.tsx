'use client';

import React, { useMemo } from 'react';
import { CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import type { ServerStatusResponse, IpAddr } from '@/lib/status/types';
import {
  Loading,
  Meter,
  STATUS_STANDARD,
  Sparkline,
  Stat,
  StatGrid,
  StatusInset,
  StatusSection,
  useStatusQuery,
  copy,
} from '../status-ui';
import { formatBytes, formatUptime, toTitleCase } from '../status-format';
import { hostCheckedMessage, hostNotices, hostUnavailableMessage } from '../host-notices';
import { readHistory } from '../use-trends';

export default function ServerTab({
  active,
  autoRefresh,
  windowHours,
}: {
  active: boolean;
  autoRefresh: boolean;
  windowHours: number;
}) {
  const { data, isLoading } = useStatusQuery<ServerStatusResponse>({
    queryKey: queryKeys.admin.statusServer(),
    path: apiPaths.admin.statusServer(),
    active,
    autoRefresh,
  });

  const system = data?.system;
  const software = data?.software;
  // Absent entirely on an older payload, which reads the same as a server AFCT cannot see.
  const host = data?.host ?? { available: false as const };
  const s = system?.stats;

  // Sparklines are read from the shared trend history the summary card persists.
  const sparklines = useMemo(() => {
    const now = Date.now();
    const hist = readHistory().filter((p) => now - p.ts <= windowHours * 3600_000);
    return {
      cpu: hist.map((p) => p.cpuPct ?? 0),
      mem: hist.map((p) => p.memPct ?? 0),
      latency: hist.map((p) => p.latencyMs ?? 0),
    };
  }, [windowHours]);

  if (isLoading || !system) {
    return <Loading />;
  }

  return (
    // The tab as a whole, not each section. Below this the individual sections narrow
    // themselves to what they hold: readings want to sit near their labels, notices want a
    // readable line, and neither wants the full width of a 1920px monitor.
    <div className="space-y-5">
      <StatusSection
        title="Performance"
        description="How hard this server is working right now, and over the chosen window."
        className={STATUS_STANDARD}
      >
        {/* Readings and their meters on one side, the trend over the chosen window on the
            other. Stacked below lg, where two of either would be too narrow to read. */}
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <div className="space-y-2">
              <Stat
                label="Arch / CPUs"
                value={`${system.arch ?? '—'} / ${system.cpuCount ?? system.cpus?.length ?? '—'}`}
              />
              <Stat label="Uptime" value={formatUptime(system.uptime)} />
              <Stat
                label="Memory"
                value={
                  system.memory
                    ? `${formatBytes(system.memory.total)} total, ${formatBytes(system.memory.free)} free`
                    : '—'
                }
              />
              <Stat
                label="Disk IO"
                value={
                  s?.diskIo
                    ? `${formatBytes(s.diskIo.readBytesPerSec)}/s read, ${formatBytes(s.diskIo.writeBytesPerSec)}/s write`
                    : '—'
                }
              />
            </div>

            <div className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">CPU (process)</span>
                  <span>{Math.round(s?.cpuProcessPct ?? 0)}%</span>
                </div>
                <Meter pct={s?.cpuProcessPct} label="CPU process usage" />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Memory (process / system)</span>
                  <span>{(s?.memProcessPctOfSystem ?? 0).toFixed(1)}%</span>
                </div>
                <Meter pct={s?.memProcessPctOfSystem} label="Process memory usage" />
              </div>
            </div>
          </div>

          {/* The SVG is a fixed size rather than a fluid one, so the width here is chosen to
              fit the narrowest this column gets: 1280 with both the sidebar and the status
              rail open. Widen it and it overflows the card there rather than reflowing. */}
          <div className="space-y-3">
            <StatusInset className="space-y-2">
              <div className="text-muted-foreground text-xs font-semibold">
                CPU % (last {windowHours}h)
              </div>
              <Sparkline points={sparklines.cpu} width={240} />
            </StatusInset>
            <StatusInset className="space-y-2">
              <div className="text-muted-foreground text-xs font-semibold">
                Mem % (last {windowHours}h)
              </div>
              <Sparkline points={sparklines.mem} width={240} />
            </StatusInset>
            <StatusInset className="space-y-2">
              <div className="text-muted-foreground text-xs font-semibold">
                Latency (ms) (last {windowHours}h)
              </div>
              <Sparkline points={sparklines.latency} width={240} />
            </StatusInset>
          </div>
        </div>
      </StatusSection>

      <StatusSection
        title="This server"
        description="What the host operating system reports about itself."
        className={STATUS_STANDARD}
      >
        {host.available ? (
          <ul className="space-y-2">
            {hostNotices(host).map((notice) => (
              <li
                key={notice.id}
                role={notice.tone === 'warn' ? 'alert' : undefined}
                // Warning colours, not destructive ones. A pending restart or a waiting
                // security update is something to schedule; red is reserved for what has
                // already gone wrong, and spending it here leaves nothing louder for that.
                className={
                  notice.tone === 'warn'
                    ? 'border-status-warning-border bg-status-warning-bg space-y-1 rounded-md border p-3'
                    : 'bg-muted/40 space-y-1 rounded-md border p-3'
                }
              >
                <div className="flex items-center gap-2 font-medium">
                  {notice.tone === 'warn' ? (
                    <TriangleAlert className="text-status-warning size-4" aria-hidden />
                  ) : notice.tone === 'ok' ? (
                    <CheckCircle2 className="size-4" aria-hidden />
                  ) : (
                    <Info className="size-4" aria-hidden />
                  )}
                  {notice.title}
                </div>
                <p className="text-muted-foreground text-sm">{notice.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{hostUnavailableMessage(host)}</p>
        )}
        {host.available && (
          <div className="space-y-2 border-t pt-3">
            <Stat label="Operating system" value={host.osName ?? '—'} />
            <p className="text-muted-foreground text-sm">{hostCheckedMessage(host, Date.now())}</p>
          </div>
        )}
      </StatusSection>

      <StatusSection title="Software" className={STATUS_STANDARD}>
        {/* Eight versions is a list to scan, not to read in order, so it pairs up rather than
            running down the page. */}
        <StatGrid>
          <Stat label="Deployment Environment" value={toTitleCase(software?.deployEnv)} />
          <Stat label="Next.js" value={software?.nextVersion ?? '—'} />
          <Stat
            label="OS / Arch"
            value={`${system.platform ?? '—'}${system.release ? ` ${system.release}` : ''} / ${system.arch ?? '—'}`}
          />
          <Stat label="AFCT Evaluator" value={software?.evaluatorVersion ?? '—'} />
          <Stat label="Node" value={software?.nodeVersion ?? '—'} />
          <Stat label="Java" value={software?.javaVersion ?? '—'} />
          {software?.buildHash && <Stat label="Build" value={software.buildHash} />}
          {software?.imageTag && <Stat label="Image" value={software.imageTag} />}
        </StatGrid>
      </StatusSection>

      <StatusSection title="Network interfaces" className={STATUS_STANDARD}>
        <Stat label="Hostname" value={system.hostname ?? '—'} />
        {(system.ipAddresses?.length ?? 0) > 0 ? (
          <ul className="bg-muted divide-y rounded-md border">
            {(system.ipAddresses as IpAddr[]).map((ip, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="text-sm">
                  <span>{ip.iface ?? 'eth'}</span>: <span>{ip.address}</span>{' '}
                  <span className="text-muted-foreground">{ip.family ? `(${ip.family})` : ''}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => copy(ip.address)}
                  aria-label={`Copy IP address ${ip.address ?? ''}`}
                >
                  Copy
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-muted-foreground text-sm">—</div>
        )}
      </StatusSection>
    </div>
  );
}
