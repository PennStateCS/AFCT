'use client';

import React, { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  SettingsStatusCard,
  SettingsStatusNextStep,
  SettingsStatusText,
} from '@/components/settings/settings-layout';
import { apiPaths } from '@/lib/api-paths';
import { queryKeys } from '@/lib/query-keys';
import type { ServerStatusResponse, IpAddr } from '@/lib/status/types';
import {
  Loading,
  Meter,
  Sparkline,
  Stat,
  StatGrid,
  StatusAsideLayout,
  StatusInset,
  StatusSection,
  useStatusQuery,
  copy,
} from '../status-ui';
import { formatBytes, formatUptime, toTitleCase } from '../status-format';
import { hostCheckedMessage, hostSummary } from '../host-notices';
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

  const hostState = hostSummary(host);

  return (
    // The sections keep the page's one measure and the machine's own state sits beside them
    // in the rail, the way a System Settings tab puts the state you are about to change next
    // to the form that changes it. Below 1600px the rail stacks above the sections.
    <StatusAsideLayout
      aside={
        <SettingsStatusCard
          title="This server"
          tone={hostState.tone}
          badge={<Badge variant={hostState.badgeVariant}>{hostState.badgeLabel}</Badge>}
          headline={hostState.headline}
        >
          <SettingsStatusText>{hostState.detail}</SettingsStatusText>

          {/* Anything else worth saying, after the one that led. Two things can be true at
              once: a clock that has drifted and updates waiting are separate jobs for
              separate people. */}
          {hostState.rest.map((notice) => (
            <div key={notice.id} className="space-y-1 border-t pt-2">
              <SettingsStatusNextStep>{notice.title}</SettingsStatusNextStep>
              <SettingsStatusText>{notice.detail}</SettingsStatusText>
            </div>
          ))}

          {host.available && (
            <div className="space-y-1 border-t pt-2">
              <SettingsStatusText>
                Running {host.osName ?? 'an unknown operating system'}.
              </SettingsStatusText>
              <SettingsStatusText>{hostCheckedMessage(host, Date.now())}</SettingsStatusText>
            </div>
          )}

          {/* The one sentence that stops this card being mistaken for the readings beside
              it. "This server" is the machine; everything in the main column is AFCT. */}
          <SettingsStatusText>
            This is the computer AFCT is installed on, not AFCT itself.
          </SettingsStatusText>
        </SettingsStatusCard>
      }
    >
      <StatusSection
        title="Performance"
        description="How hard this server is working right now, and over the chosen window."
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
              rail open. Widen it and it overflows the card there rather than reflowing. It
              is also what sets the breakpoint the rail beside these sections appears at, so
              the two numbers move together (see `StatusAsideLayout`). */}
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

      <StatusSection title="Software">
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

      <StatusSection title="Network interfaces">
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
    </StatusAsideLayout>
  );
}
